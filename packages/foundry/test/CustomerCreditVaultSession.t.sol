// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../src/CustomerCreditVault.sol";

contract SessionMockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/**
 * Session grants: a standing authorization that lets the billing signer charge without a
 * per-reservation customer signature, bounded by a cap and an expiry.
 */
contract CustomerCreditVaultSessionTest is Test {
    CustomerCreditVault public vault;
    SessionMockUSDC public usdc;

    address public admin = address(0x1);
    address public billing = address(0x2);
    address public treasury = address(0x3);
    address public customer = address(0xC0FFEE);

    uint256 private constant DEPOSIT = 500_000_000; // 500 USDC
    uint256 private constant CAP = 100_000_000; // 100 USDC
    bytes32 private termsHash = keccak256("terms");

    function setUp() public {
        usdc = new SessionMockUSDC();
        vault = new CustomerCreditVault(address(usdc), admin, billing, treasury);
        usdc.mint(customer, 1_000_000_000);
        vm.prank(customer);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _expiry() private view returns (uint48) {
        return uint48(block.timestamp + 1 days);
    }

    function _grantedDeposit() private returns (uint48 expiresAt) {
        expiresAt = _expiry();
        vm.prank(customer);
        vault.depositWithGrant(DEPOSIT, CAP, expiresAt);
    }

    /// Reserve with an empty signature — the grant path.
    function _reserveViaGrant(bytes32 id, uint256 amount) private {
        vm.prank(billing);
        vault.reserve(id, customer, amount, uint48(block.timestamp + 1 hours), termsHash, "");
    }

    function test_depositWithGrantFundsAndAuthorizesInOneTransaction() public {
        uint48 expiresAt = _grantedDeposit();

        assertEq(vault.availableCreditOf(customer), DEPOSIT);
        (uint256 maxTotalCharge, uint256 spent, uint48 storedExpiry) = vault.sessionGrantOf(customer);
        assertEq(maxTotalCharge, CAP);
        assertEq(spent, 0);
        assertEq(storedExpiry, expiresAt);
        assertEq(vault.remainingSessionAllowance(customer), CAP);
    }

    function test_reserveNeedsNoSignatureWhileGrantIsLive() public {
        _grantedDeposit();

        _reserveViaGrant(keccak256("r1"), 10_000_000);
        _reserveViaGrant(keccak256("r2"), 15_000_000);

        (, uint256 spent,) = vault.sessionGrantOf(customer);
        assertEq(spent, 25_000_000);
        assertEq(vault.reservedCreditOf(customer), 25_000_000);
        assertEq(vault.remainingSessionAllowance(customer), CAP - 25_000_000);
    }

    function test_settlementRefundsUnusedBudgetToTheGrant() public {
        _grantedDeposit();
        _reserveViaGrant(keccak256("r1"), 20_000_000);

        vm.prank(billing);
        vault.settle(keccak256("r1"), 5_000_000);

        // Only the settled amount stays spent against the cap.
        (, uint256 spent,) = vault.sessionGrantOf(customer);
        assertEq(spent, 5_000_000);
        assertEq(vault.remainingSessionAllowance(customer), CAP - 5_000_000);
        assertEq(vault.unwithdrawnRevenue(), 5_000_000);
    }

    function test_releaseReturnsTheWholeReservationToTheGrant() public {
        _grantedDeposit();
        _reserveViaGrant(keccak256("r1"), 20_000_000);

        vm.prank(billing);
        vault.release(keccak256("r1"));

        (, uint256 spent,) = vault.sessionGrantOf(customer);
        assertEq(spent, 0);
        assertEq(vault.remainingSessionAllowance(customer), CAP);
    }

    function test_grantCannotBeOverdrawn() public {
        _grantedDeposit();
        _reserveViaGrant(keccak256("r1"), CAP);

        vm.prank(billing);
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomerCreditVault.SessionGrantExhausted.selector, customer, 1, 0
            )
        );
        vault.reserve(keccak256("r2"), customer, 1, uint48(block.timestamp + 1 hours), termsHash, "");
    }

    function test_grantStopsWorkingAfterExpiry() public {
        uint48 expiresAt = _grantedDeposit();
        vm.warp(expiresAt);

        assertEq(vault.remainingSessionAllowance(customer), 0);
        vm.prank(billing);
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomerCreditVault.SessionGrantExpired.selector, customer, expiresAt, block.timestamp
            )
        );
        vault.reserve(keccak256("r1"), customer, 1_000, uint48(block.timestamp + 1 hours), termsHash, "");
    }

    function test_customerCanRevokeImmediately() public {
        _grantedDeposit();

        vm.prank(customer);
        vault.revokeSessionGrant();

        assertEq(vault.remainingSessionAllowance(customer), 0);
        vm.prank(billing);
        vm.expectRevert(CustomerCreditVault.InvalidSessionGrant.selector);
        vault.reserve(keccak256("r1"), customer, 1_000, uint48(block.timestamp + 1 hours), termsHash, "");
    }

    function test_reserveWithoutAnyGrantIsRejected() public {
        vm.prank(customer);
        vault.deposit(DEPOSIT);

        vm.prank(billing);
        vm.expectRevert(CustomerCreditVault.InvalidSessionGrant.selector);
        vault.reserve(keccak256("r1"), customer, 1_000, uint48(block.timestamp + 1 hours), termsHash, "");
    }

    /// A grant for one customer must never authorize spending another's credit.
    function test_grantIsScopedToItsOwnCustomer() public {
        _grantedDeposit();

        address other = address(0xBEEF);
        usdc.mint(other, DEPOSIT);
        vm.startPrank(other);
        usdc.approve(address(vault), DEPOSIT);
        vault.deposit(DEPOSIT);
        vm.stopPrank();

        vm.prank(billing);
        vm.expectRevert(CustomerCreditVault.InvalidSessionGrant.selector);
        vault.reserve(keccak256("r1"), other, 1_000, uint48(block.timestamp + 1 hours), termsHash, "");
    }

    /// Re-granting resets the counter; it must not carry stale spend or stack allowances.
    function test_regrantingResetsTheSpentCounter() public {
        _grantedDeposit();
        _reserveViaGrant(keccak256("r1"), 30_000_000);

        vm.prank(customer);
        vault.grantSession(CAP, _expiry());

        (, uint256 spent,) = vault.sessionGrantOf(customer);
        assertEq(spent, 0);
        assertEq(vault.remainingSessionAllowance(customer), CAP);
    }

    /// The cap must hold no matter how charges are split, settled, or released.
    function testFuzz_spentNeverExceedsTheCap(uint96 a, uint96 b, uint96 settleA) public {
        uint256 chargeA = bound(uint256(a), 1, CAP);
        uint256 chargeB = bound(uint256(b), 1, CAP);
        _grantedDeposit();

        _reserveViaGrant(keccak256("r1"), chargeA);
        (, uint256 spentAfterA,) = vault.sessionGrantOf(customer);
        assertLe(spentAfterA, CAP);

        uint256 finalA = bound(uint256(settleA), 0, chargeA);
        vm.prank(billing);
        vault.settle(keccak256("r1"), finalA);

        (, uint256 spentAfterSettle,) = vault.sessionGrantOf(customer);
        assertLe(spentAfterSettle, CAP);
        assertEq(spentAfterSettle, finalA);

        if (chargeB <= CAP - spentAfterSettle) {
            _reserveViaGrant(keccak256("r2"), chargeB);
            (, uint256 spentFinal,) = vault.sessionGrantOf(customer);
            assertLe(spentFinal, CAP);
        }
    }

    /// Reported: releasing a reservation made under an OLD grant must not credit budget
    /// back to a replacement grant, or the cap on the replacement can be exceeded.
    function test_releaseDoesNotRefundIntoAReplacementGrant() public {
        _grantedDeposit();

        // Reservation under grant #1.
        _reserveViaGrant(keccak256("old"), 40_000_000);

        // Customer replaces the grant; the new one starts clean.
        vm.prank(customer);
        vault.grantSession(CAP, _expiry());
        assertEq(vault.remainingSessionAllowance(customer), CAP);

        // Spend the replacement grant down to zero.
        _reserveViaGrant(keccak256("new"), CAP);
        assertEq(vault.remainingSessionAllowance(customer), 0);

        // Release the stale reservation. Its budget belonged to grant #1.
        vm.prank(billing);
        vault.release(keccak256("old"));

        // The replacement grant must still be exhausted.
        assertEq(
            vault.remainingSessionAllowance(customer),
            0,
            "stale reservation refunded into the replacement grant"
        );
    }
}
