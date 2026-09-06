// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CustomerCreditVault} from "../src/CustomerCreditVault.sol";
import {MockUSDC} from "./CustomerCreditVault.t.sol";

contract CustomerCreditVaultHandler is Test {
    CustomerCreditVault public immutable vault;
    MockUSDC public immutable usdc;
    address public immutable billing;
    address public immutable treasury;

    address[3] public customers;
    uint256[3] private customerKeys;
    bytes32[] public reservationIds;
    uint256 private nextReservation;

    constructor(CustomerCreditVault target, MockUSDC token, address billingAccount, address treasuryAccount) {
        vault = target;
        usdc = token;
        billing = billingAccount;
        treasury = treasuryAccount;
        customerKeys = [uint256(0x1001), uint256(0x1002), uint256(0x1003)];
        customers = [vm.addr(customerKeys[0]), vm.addr(customerKeys[1]), vm.addr(customerKeys[2])];
    }

    function deposit(uint256 customerSeed, uint256 amount) external {
        uint256 customerIndex = customerSeed % customers.length;
        address customer = customers[customerIndex];
        amount = bound(amount, 1, 1_000_000_000_000);
        usdc.mint(customer, amount);
        vm.startPrank(customer);
        usdc.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }

    function withdraw(uint256 customerSeed, uint256 amount) external {
        address customer = customers[customerSeed % customers.length];
        uint256 available = vault.availableCreditOf(customer);
        if (available == 0) return;
        amount = bound(amount, 1, available);
        vm.prank(customer);
        vault.withdraw(amount);
    }

    function reserve(uint256 customerSeed, uint256 amount, uint48 lifetime) external {
        uint256 customerIndex = customerSeed % customers.length;
        address customer = customers[customerIndex];
        uint256 available = vault.availableCreditOf(customer);
        if (available == 0) return;
        amount = bound(amount, 1, available);
        lifetime = uint48(bound(lifetime, 1, 30 days));
        bytes32 reservationId = keccak256(abi.encode("invariant", nextReservation++));
        uint48 expiresAt = uint48(block.timestamp) + lifetime;
        (bytes32 termsHash, bytes memory signature) =
            _reservationSignature(customerIndex, reservationId, amount, expiresAt);
        reservationIds.push(reservationId);
        vm.prank(billing);
        vault.reserve(reservationId, customer, amount, expiresAt, termsHash, signature);
    }

    function settle(uint256 reservationSeed, uint256 finalCharge) external {
        if (reservationIds.length == 0) return;
        bytes32 reservationId = reservationIds[reservationSeed % reservationIds.length];
        (,,, CustomerCreditVault.ReservationStatus status,,,) = vault.reservations(reservationId);
        if (status != CustomerCreditVault.ReservationStatus.Active) return;
        (, uint256 maximumCharge,,,,,) = vault.reservations(reservationId);
        finalCharge = bound(finalCharge, 0, maximumCharge);
        vm.prank(billing);
        vault.settle(reservationId, finalCharge);
    }

    function release(uint256 reservationSeed) external {
        if (reservationIds.length == 0) return;
        bytes32 reservationId = reservationIds[reservationSeed % reservationIds.length];
        (,,, CustomerCreditVault.ReservationStatus status,,,) = vault.reservations(reservationId);
        if (status != CustomerCreditVault.ReservationStatus.Active) return;
        vm.prank(billing);
        vault.release(reservationId);
    }

    function expire(uint256 reservationSeed) external {
        if (reservationIds.length == 0) return;
        bytes32 reservationId = reservationIds[reservationSeed % reservationIds.length];
        (,, uint48 expiresAt, CustomerCreditVault.ReservationStatus status,,,) = vault.reservations(reservationId);
        if (status != CustomerCreditVault.ReservationStatus.Active) return;
        vm.warp(expiresAt);
        vault.expire(reservationId);
    }

    function withdrawRevenue(uint256 amount) external {
        uint256 revenue = vault.unwithdrawnRevenue();
        if (revenue == 0) return;
        amount = bound(amount, 1, revenue);
        vm.prank(treasury);
        vault.withdrawRevenue(treasury, amount);
    }

    function _reservationSignature(uint256 customerIndex, bytes32 reservationId, uint256 amount, uint48 expiresAt)
        private
        view
        returns (bytes32 termsHash, bytes memory signature)
    {
        termsHash = keccak256(abi.encode("invariant-terms", reservationId));
        bytes32 digest = vault.reservationDigest(reservationId, customers[customerIndex], amount, expiresAt, termsHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(customerKeys[customerIndex], digest);
        signature = abi.encodePacked(r, s, v);
    }
}

contract CustomerCreditVaultInvariantTest is Test {
    CustomerCreditVault private vault;
    MockUSDC private usdc;
    CustomerCreditVaultHandler private handler;
    address private billing = makeAddr("invariant-billing");
    address private treasury = makeAddr("invariant-treasury");

    function setUp() public {
        usdc = new MockUSDC();
        vault = new CustomerCreditVault(address(usdc), address(this), billing, treasury);
        handler = new CustomerCreditVaultHandler(vault, usdc, billing, treasury);
        targetContract(address(handler));
    }

    function invariant_VaultAlwaysCoversCustomerLiabilityAndRevenue() public view {
        assertGe(usdc.balanceOf(address(vault)), vault.totalCustomerLiability() + vault.unwithdrawnRevenue());
    }

    function invariant_CustomerSumsMatchGlobalLiabilities() public view {
        uint256 available;
        uint256 reserved;
        for (uint256 index = 0; index < 3; ++index) {
            address customer = handler.customers(index);
            available += vault.availableCreditOf(customer);
            reserved += vault.reservedCreditOf(customer);
        }
        assertEq(available, vault.totalAvailableLiability());
        assertEq(reserved, vault.totalReservedLiability());
    }
}
