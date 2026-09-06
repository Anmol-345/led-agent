// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AgentWallet} from "../src/AgentWallet.sol";
import {CustomerCreditVault} from "../src/CustomerCreditVault.sol";

/// @dev Mock USDC for BOT Chain — no native Circle USDC on 677/968 yet.
contract BotchainCreditUSDC is ERC20 {
    constructor() ERC20("BOT Chain USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

/**
 * @title DeployBotchain
 * @notice Deploys AgentWallet + mock USDC + CustomerCreditVault on BOT Chain only.
 * @dev Seatbelt: require chainId 677 (mainnet) or 968 (testnet).
 *      Writes nothing to disk — the Node wrapper records deployments/botchain-<id>.json.
 */
contract DeployBotchain is Script {
    uint256 private constant BOTCHAIN_MAINNET = 677;
    uint256 private constant BOTCHAIN_TESTNET = 968;

    function run() external {
        require(
            block.chainid == BOTCHAIN_MAINNET || block.chainid == BOTCHAIN_TESTNET,
            "wrong chain"
        );

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address agentAddr = vm.envOr("AGENT_ADDRESS", address(0));

        // BOT Chain demo: deployer may hold all roles (no native USDC / no multisig required).
        // Override via env for production-hardening later.
        address admin = vm.envOr("CREDIT_ADMIN_ADDRESS", deployer);
        address billing = vm.envOr("CREDIT_BILLING_ADDRESS", deployer);
        address treasury = vm.envOr("CREDIT_TREASURY_ADDRESS", deployer);

        vm.startBroadcast(deployerKey);

        AgentWallet wallet = new AgentWallet(agentAddr);

        address usdc = vm.envOr("CREDIT_REHEARSAL_USDC_ADDRESS", address(0));
        if (usdc == address(0)) {
            usdc = address(new BotchainCreditUSDC());
        }

        CustomerCreditVault vault = new CustomerCreditVault(usdc, admin, billing, treasury);

        vm.stopBroadcast();

        string memory explorer = block.chainid == BOTCHAIN_MAINNET
            ? "https://scan.botchain.ai/address/"
            : "https://scan.bohr.life/address/";

        console.log("chainId :", block.chainid);
        console.log("deployer:", deployer);
        console.log("CREDIT_USDC_ADDRESS=%s", usdc);
        console.log("CREDIT_VAULT_ADDRESS=%s", address(vault));
        console.log("AGENT_WALLET_ADDRESS=%s", address(wallet));
        console.log("explorer_usdc :", string.concat(explorer, vm.toString(usdc)));
        console.log("explorer_vault:", string.concat(explorer, vm.toString(address(vault))));
        console.log("explorer_wallet:", string.concat(explorer, vm.toString(address(wallet))));
    }
}
