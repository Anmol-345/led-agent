// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AgentWallet} from "../src/AgentWallet.sol";
import {CustomerCreditVault} from "../src/CustomerCreditVault.sol";

contract LocalCreditUSDC is ERC20 {
    constructor() ERC20("Local USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract Deploy is Script {
    uint256 private constant BASE_MAINNET = 8453;
    address private constant BASE_NATIVE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address agentAddr = vm.envOr("AGENT_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);
        new AgentWallet(agentAddr);

        if (block.chainid == BASE_MAINNET) {
            // Production. Roles must be separated and the admin must be a contract
            // (multisig/timelock), so a single compromised EOA cannot drain the vault.
            address admin = vm.envAddress("CREDIT_ADMIN_ADDRESS");
            address billing = vm.envAddress("CREDIT_BILLING_ADDRESS");
            address treasury = vm.envAddress("CREDIT_TREASURY_ADDRESS");
            require(admin.code.length > 0, "production credit admin must be a contract");
            require(
                admin != billing && admin != treasury && billing != treasury && billing != deployer
                    && treasury != deployer,
                "production credit roles must be distinct"
            );
            new CustomerCreditVault(BASE_NATIVE_USDC, admin, billing, treasury);
        } else {
            // Testnet (Sepolia) and local Anvil. Deploy the mock USDC unless an existing
            // one is supplied, and let the deployer hold every role — there is nothing of
            // value at stake and it keeps the demo one command.
            address usdc = vm.envOr("CREDIT_REHEARSAL_USDC_ADDRESS", address(0));
            if (usdc == address(0)) {
                usdc = address(new LocalCreditUSDC());
            }
            CustomerCreditVault vault = new CustomerCreditVault(
                usdc,
                vm.envOr("CREDIT_ADMIN_ADDRESS", deployer),
                vm.envOr("CREDIT_BILLING_ADDRESS", deployer),
                vm.envOr("CREDIT_TREASURY_ADDRESS", deployer)
            );
            // Printed so the values can be copied into .env; the app needs both.
            console.log("CREDIT_USDC_ADDRESS=%s", usdc);
            console.log("CREDIT_VAULT_ADDRESS=%s", address(vault));
        }
        vm.stopBroadcast();
    }
}
