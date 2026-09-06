// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CustomerCreditVault} from "../src/CustomerCreditVault.sol";

/// @dev Completes a partial BOT Chain mainnet deploy (wallet + USDC already live).
contract DeployVaultOnly is Script {
    function run() external {
        require(block.chainid == 677 || block.chainid == 968, "wrong chain");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address usdc = vm.envAddress("CREDIT_REHEARSAL_USDC_ADDRESS");
        address admin = vm.envOr("CREDIT_ADMIN_ADDRESS", deployer);
        address billing = vm.envOr("CREDIT_BILLING_ADDRESS", deployer);
        address treasury = vm.envOr("CREDIT_TREASURY_ADDRESS", deployer);

        vm.startBroadcast(deployerKey);
        CustomerCreditVault vault = new CustomerCreditVault(usdc, admin, billing, treasury);
        vm.stopBroadcast();

        console.log("CREDIT_VAULT_ADDRESS=%s", address(vault));
        console.log(
            "explorer:",
            block.chainid == 677
                ? string.concat("https://scan.botchain.ai/address/", vm.toString(address(vault)))
                : string.concat("https://scan.bohr.life/address/", vm.toString(address(vault)))
        );
    }
}
