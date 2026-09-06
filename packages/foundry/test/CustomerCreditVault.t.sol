// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "../src/CustomerCreditVault.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract FeeOnTransferUSDC is MockUSDC {
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && value > 1) {
            super._update(from, address(0xfee), 1);
            super._update(from, to, value - 1);
            return;
        }
        super._update(from, to, value);
    }
}

contract ReentrantUSDC is MockUSDC {
    CustomerCreditVault public vault;
    bool public attack;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    function setVault(CustomerCreditVault target) external {
        vault = target;
    }

    function setAttack(bool enabled) external {
        attack = enabled;
        reentryAttempted = false;
        reentrySucceeded = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (attack && address(vault) != address(0)) {
            if (to == address(vault)) {
                reentryAttempted = true;
                (reentrySucceeded,) = address(vault).call(abi.encodeCall(CustomerCreditVault.deposit, (1)));
            } else if (from == address(vault)) {
                reentryAttempted = true;
                (reentrySucceeded,) = address(vault).call(abi.encodeCall(CustomerCreditVault.withdraw, (1)));
            }
        }
        super._update(from, to, value);
    }
}

contract Mock1271Customer is IERC1271 {
    bytes32 public approvedDigest;

    function approveDigest(bytes32 digest) external {
        approvedDigest = digest;
    }

    function approveAndDeposit(MockUSDC token, CustomerCreditVault vault, uint256 amount) external {
        token.approve(address(vault), amount);
        vault.deposit(amount);
    }

    function isValidSignature(bytes32 hash, bytes memory) external view returns (bytes4) {
        return hash == approvedDigest ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}

contract CustomerCreditVaultTest is Test {
    CustomerCreditVault public vault;
    MockUSDC public usdc;

    address public admin = address(0x1);
    address public billing = address(0x2);
    address public treasury = address(0x3);
    uint256 private customerPrivateKey = 0xC0570A;
    address public customer;
    address public customer2 = address(0x5);

    bytes32 public resId1 = keccak256("reservation-1");
    bytes32 public resId2 = keccak256("reservation-2");
    bytes32 private termsHash = keccak256("signed-terms");

    function setUp() public {
        customer = vm.addr(customerPrivateKey);
        usdc = new MockUSDC();
        vault = new CustomerCreditVault(address(usdc), admin, billing, treasury);

        usdc.mint(customer, 1_000_000_000); // 1,000 USDC (6 decimals)
        usdc.mint(customer2, 500_000_000); // 500 USDC

        vm.prank(customer);
        usdc.approve(address(vault), 1_000_000_000);

        vm.prank(customer2);
        usdc.approve(address(vault), 500_000_000);
    }

    function _customerSignature(bytes32 reservationId, uint256 maximumCharge, uint48 expiresAt)
        private
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            customerPrivateKey, vault.reservationDigest(reservationId, customer, maximumCharge, expiresAt, termsHash)
        );
        return abi.encodePacked(r, s, v);
    }

    function _reserve(bytes32 reservationId, uint256 maximumCharge, uint48 expiresAt) private {
        bytes memory signature = _customerSignature(reservationId, maximumCharge, expiresAt);
        vm.prank(billing);
        vault.reserve(reservationId, customer, maximumCharge, expiresAt, termsHash, signature);
    }

    function test_Deposit() public {
        vm.prank(customer);
        vault.deposit(100_000_000); // 100 USDC

        assertEq(vault.availableCreditOf(customer), 100_000_000);
        assertEq(vault.reservedCreditOf(customer), 0);
        assertEq(vault.totalCustomerLiability(), 100_000_000);
        assertEq(usdc.balanceOf(address(vault)), 100_000_000);
    }

    function test_WithdrawAvailable() public {
        vm.prank(customer);
        vault.deposit(100_000_000);

        vm.prank(customer);
        vault.withdraw(40_000_000);

        assertEq(vault.availableCreditOf(customer), 60_000_000);
        assertEq(usdc.balanceOf(customer), 940_000_000);
    }

    function test_ReserveAndSettle() public {
        vm.prank(customer);
        vault.deposit(100_000_000);

        uint48 expiresAt = uint48(block.timestamp + 3600);
        _reserve(resId1, 50_000_000, expiresAt);

        assertEq(vault.availableCreditOf(customer), 50_000_000);
        assertEq(vault.reservedCreditOf(customer), 50_000_000);

        vm.prank(billing);
        vault.settle(resId1, 30_000_000);

        assertEq(vault.availableCreditOf(customer), 70_000_000); // 20_000_000 released back
        assertEq(vault.reservedCreditOf(customer), 0);
        assertEq(vault.unwithdrawnRevenue(), 30_000_000);
        assertEq(vault.totalCustomerLiability(), 70_000_000);
        (,,,, uint256 finalCharge,,) = vault.reservations(resId1);
        assertEq(finalCharge, 30_000_000);
    }

    function test_Release() public {
        vm.prank(customer);
        vault.deposit(100_000_000);

        uint48 expiresAt = uint48(block.timestamp + 3600);
        _reserve(resId1, 50_000_000, expiresAt);

        vm.prank(billing);
        vault.release(resId1);

        assertEq(vault.availableCreditOf(customer), 100_000_000);
        assertEq(vault.reservedCreditOf(customer), 0);
    }

    function test_Expire() public {
        vm.prank(customer);
        vault.deposit(100_000_000);

        uint48 expiresAt = uint48(block.timestamp + 3600);
        _reserve(resId1, 50_000_000, expiresAt);

        vm.warp(block.timestamp + 3601);
        vault.expire(resId1); // Anyone can call after expiration

        assertEq(vault.availableCreditOf(customer), 100_000_000);
        assertEq(vault.reservedCreditOf(customer), 0);
    }

    function test_WithdrawRevenue() public {
        vm.prank(customer);
        vault.deposit(100_000_000);

        _reserve(resId1, 50_000_000, uint48(block.timestamp + 3600));

        vm.prank(billing);
        vault.settle(resId1, 50_000_000);

        address recipient = address(0x99);
        vm.prank(treasury);
        vault.withdrawRevenue(recipient, 50_000_000);

        assertEq(usdc.balanceOf(recipient), 50_000_000);
        assertEq(vault.unwithdrawnRevenue(), 0);
    }

    function test_PauseBlocksDangerousRolesButNotCustomerWithdrawOrRelease() public {
        vm.prank(customer);
        vault.deposit(100_000_000);

        _reserve(resId1, 50_000_000, uint48(block.timestamp + 3600));

        _reserve(resId2, 20_000_000, uint48(block.timestamp + 3600));

        vm.prank(billing);
        vault.settle(resId2, 10_000_000);

        vm.prank(admin);
        vault.pause();

        vm.prank(billing);
        vm.expectRevert();
        vault.settle(resId1, 10_000_000);

        vm.prank(treasury);
        vm.expectRevert();
        vault.withdrawRevenue(address(0x99), 1);

        vm.prank(customer);
        vault.withdraw(10_000_000);

        vm.prank(billing);
        vault.release(resId1);

        vm.prank(customer);
        vm.expectRevert();
        vault.deposit(10_000_000);
    }

    function test_RevertIf_BillingMutatesCustomerSignedReservationCap() public {
        vm.prank(customer);
        vault.deposit(100_000_000);
        uint48 expiresAt = uint48(block.timestamp + 3600);
        bytes memory signature = _customerSignature(resId1, 50_000_000, expiresAt);

        vm.prank(billing);
        vm.expectRevert(
            abi.encodeWithSelector(CustomerCreditVault.InvalidReservationAuthorization.selector, resId1, customer)
        );
        vault.reserve(resId1, customer, 60_000_000, expiresAt, termsHash, signature);

        vm.prank(billing);
        vm.expectRevert(
            abi.encodeWithSelector(CustomerCreditVault.InvalidReservationAuthorization.selector, resId1, customer)
        );
        vault.reserve(resId1, customer, 50_000_000, expiresAt, keccak256("mutated-terms"), signature);

        assertEq(vault.availableCreditOf(customer), 100_000_000);
        assertEq(vault.reservedCreditOf(customer), 0);
    }

    function test_RevertIf_ReservationSignatureIsReplayedAcrossVaultOrChain() public {
        uint48 expiresAt = uint48(block.timestamp + 3600);
        bytes memory signature = _customerSignature(resId1, 50_000_000, expiresAt);
        CustomerCreditVault otherVault = new CustomerCreditVault(address(usdc), admin, billing, treasury);

        vm.prank(billing);
        vm.expectRevert(
            abi.encodeWithSelector(CustomerCreditVault.InvalidReservationAuthorization.selector, resId1, customer)
        );
        otherVault.reserve(resId1, customer, 50_000_000, expiresAt, termsHash, signature);

        vm.chainId(block.chainid + 1);
        vm.prank(billing);
        vm.expectRevert(
            abi.encodeWithSelector(CustomerCreditVault.InvalidReservationAuthorization.selector, resId1, customer)
        );
        vault.reserve(resId1, customer, 50_000_000, expiresAt, termsHash, signature);
    }

    function test_ReserveAcceptsEip1271CustomerAuthorization() public {
        Mock1271Customer contractCustomer = new Mock1271Customer();
        usdc.mint(address(contractCustomer), 100_000_000);
        contractCustomer.approveAndDeposit(usdc, vault, 100_000_000);
        uint48 expiresAt = uint48(block.timestamp + 3600);
        bytes32 digest = vault.reservationDigest(resId1, address(contractCustomer), 50_000_000, expiresAt, termsHash);
        contractCustomer.approveDigest(digest);

        vm.prank(billing);
        vault.reserve(resId1, address(contractCustomer), 50_000_000, expiresAt, termsHash, hex"01");

        assertEq(vault.availableCreditOf(address(contractCustomer)), 50_000_000);
        assertEq(vault.reservedCreditOf(address(contractCustomer)), 50_000_000);
        (,,,,, bytes32 storedTermsHash,) = vault.reservations(resId1);
        assertEq(storedTermsHash, termsHash);
    }

    function test_RevertIf_ZeroAddressConstructor() public {
        vm.expectRevert(CustomerCreditVault.ZeroAddress.selector);
        new CustomerCreditVault(address(0), admin, billing, treasury);

        vm.expectRevert(CustomerCreditVault.ZeroAddress.selector);
        new CustomerCreditVault(address(usdc), address(0), billing, treasury);
    }

    function test_BaseMainnetConstructorAcceptsOnlyNativeUsdc() public {
        vm.chainId(8453);
        vm.expectRevert(abi.encodeWithSelector(CustomerCreditVault.UnsupportedBaseUsdc.selector, address(usdc)));
        new CustomerCreditVault(address(usdc), admin, billing, treasury);

        CustomerCreditVault baseVault =
            new CustomerCreditVault(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, admin, billing, treasury);
        assertEq(address(baseVault.usdc()), 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    }

    function test_RevertIf_DepositZero() public {
        vm.prank(customer);
        vm.expectRevert(CustomerCreditVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_RevertIf_DepositReceivesLessThanRequested() public {
        FeeOnTransferUSDC feeToken = new FeeOnTransferUSDC();
        CustomerCreditVault feeVault = new CustomerCreditVault(address(feeToken), admin, billing, treasury);
        feeToken.mint(customer, 100_000_000);

        vm.startPrank(customer);
        feeToken.approve(address(feeVault), 100_000_000);
        vm.expectRevert(
            abi.encodeWithSelector(CustomerCreditVault.UnexpectedDepositAmount.selector, 100_000_000, 99_999_999)
        );
        feeVault.deposit(100_000_000);
        vm.stopPrank();

        assertEq(feeVault.availableCreditOf(customer), 0);
        assertEq(feeVault.totalCustomerLiability(), 0);
        assertEq(feeToken.balanceOf(address(feeVault)), 0);
    }

    function test_ReentrantTokenCallbacksCannotChangeAccounting() public {
        ReentrantUSDC reentrantToken = new ReentrantUSDC();
        CustomerCreditVault reentrantVault = new CustomerCreditVault(address(reentrantToken), admin, billing, treasury);
        reentrantToken.setVault(reentrantVault);
        reentrantToken.mint(customer, 100_000_000);

        vm.startPrank(customer);
        reentrantToken.approve(address(reentrantVault), 100_000_000);
        reentrantToken.setAttack(true);
        reentrantVault.deposit(100_000_000);
        vm.stopPrank();

        assertTrue(reentrantToken.reentryAttempted());
        assertFalse(reentrantToken.reentrySucceeded());
        assertEq(reentrantVault.availableCreditOf(customer), 100_000_000);
        assertEq(reentrantVault.totalCustomerLiability(), 100_000_000);

        reentrantToken.setAttack(true);
        vm.prank(customer);
        reentrantVault.withdraw(40_000_000);

        assertTrue(reentrantToken.reentryAttempted());
        assertFalse(reentrantToken.reentrySucceeded());
        assertEq(reentrantVault.availableCreditOf(customer), 60_000_000);
        assertEq(reentrantVault.totalCustomerLiability(), 60_000_000);
        assertEq(
            reentrantToken.balanceOf(address(reentrantVault)),
            reentrantVault.totalCustomerLiability() + reentrantVault.unwithdrawnRevenue()
        );
    }

    function test_RevertIf_WithdrawExceedsAvailable() public {
        vm.prank(customer);
        vault.deposit(50_000_000);

        vm.prank(customer);
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomerCreditVault.InsufficientAvailableCredit.selector, customer, 60_000_000, 50_000_000
            )
        );
        vault.withdraw(60_000_000);
    }

    function test_RevertIf_ReserveNotBillingRole() public {
        vm.prank(customer);
        vault.deposit(100_000_000);

        vm.prank(customer);
        vm.expectRevert();
        vault.reserve(resId1, customer, 50_000_000, uint48(block.timestamp + 3600), termsHash, "");
    }

    function test_RevertIf_ReserveDuplicateId() public {
        vm.prank(customer);
        vault.deposit(100_000_000);

        _reserve(resId1, 50_000_000, uint48(block.timestamp + 3600));

        vm.prank(billing);
        vm.expectRevert(abi.encodeWithSelector(CustomerCreditVault.DuplicateReservationId.selector, resId1));
        vault.reserve(resId1, customer, 20_000_000, uint48(block.timestamp + 3600), termsHash, "");
    }

    function test_RevertIf_SettleExcessiveCharge() public {
        vm.prank(customer);
        vault.deposit(100_000_000);

        _reserve(resId1, 50_000_000, uint48(block.timestamp + 3600));

        vm.prank(billing);
        vm.expectRevert(
            abi.encodeWithSelector(CustomerCreditVault.ExcessiveSettlement.selector, resId1, 60_000_000, 50_000_000)
        );
        vault.settle(resId1, 60_000_000);
    }

    function test_RevertIf_SettleAtExpiryBoundary() public {
        vm.prank(customer);
        vault.deposit(100_000_000);

        uint48 expiresAt = uint48(block.timestamp + 3600);
        _reserve(resId1, 50_000_000, expiresAt);
        vm.warp(expiresAt);

        vm.prank(billing);
        vm.expectRevert(
            abi.encodeWithSelector(CustomerCreditVault.ReservationExpired.selector, resId1, expiresAt, block.timestamp)
        );
        vault.settle(resId1, 10_000_000);
    }

    function test_RevertIf_ExpireBeforeExpiry() public {
        vm.prank(customer);
        vault.deposit(100_000_000);

        uint48 expiresAt = uint48(block.timestamp + 3600);
        _reserve(resId1, 50_000_000, expiresAt);

        vm.expectRevert(
            abi.encodeWithSelector(
                CustomerCreditVault.ReservationNotExpired.selector, resId1, expiresAt, block.timestamp
            )
        );
        vault.expire(resId1);
    }

    function test_AgentWalletHasNoAuthority() public {
        address agentWallet = address(0xAA);
        vm.prank(customer);
        vault.deposit(100_000_000);

        vm.prank(agentWallet);
        vm.expectRevert();
        vault.reserve(resId1, customer, 50_000_000, uint48(block.timestamp + 3600), termsHash, "");

        vm.prank(agentWallet);
        vm.expectRevert();
        vault.withdrawRevenue(agentWallet, 10_000_000);
    }

    function testFuzz_DepositAndWithdraw(uint256 amount) public {
        amount = bound(amount, 1, 500_000_000);

        vm.prank(customer);
        vault.deposit(amount);

        assertEq(vault.availableCreditOf(customer), amount);
        assertEq(vault.totalCustomerLiability(), amount);
        assertEq(usdc.balanceOf(address(vault)), amount);

        vm.prank(customer);
        vault.withdraw(amount);

        assertEq(vault.availableCreditOf(customer), 0);
        assertEq(vault.totalCustomerLiability(), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function testFuzz_ReserveAndSettle(uint256 depositAmt, uint256 reserveAmt, uint256 finalCharge) public {
        depositAmt = bound(depositAmt, 1, 1_000_000_000);
        reserveAmt = bound(reserveAmt, 1, depositAmt);
        finalCharge = bound(finalCharge, 0, reserveAmt);

        vm.prank(customer);
        vault.deposit(depositAmt);

        _reserve(resId1, reserveAmt, uint48(block.timestamp + 3600));

        vm.prank(billing);
        vault.settle(resId1, finalCharge);

        assertEq(vault.unwithdrawnRevenue(), finalCharge);
        assertEq(vault.totalCustomerLiability(), depositAmt - finalCharge);
        assertEq(usdc.balanceOf(address(vault)), vault.totalCustomerLiability() + vault.unwithdrawnRevenue());
    }
}
