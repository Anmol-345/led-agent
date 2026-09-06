// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {CustomerCreditVault} from "../src/CustomerCreditVault.sol";
import {AgentWallet} from "../src/AgentWallet.sol";

/**
 * @notice Fork tests against live BOT Chain mainnet after deploy.
 * @dev Set env: VAULT_ADDRESS, AGENT_WALLET_ADDRESS, DEPLOYER_ADDRESS
 *      Run: forge test --match-contract BotchainMainnetVerify -vvv
 *      Skips when VAULT_ADDRESS unset so local `forge test` stays green.
 */
contract BotchainMainnetVerify is Test {
    CustomerCreditVault vault;
    AgentWallet wallet;
    bool ready;

    function setUp() public {
        address vaultAddr = vm.envOr("VAULT_ADDRESS", address(0));
        if (vaultAddr == address(0)) {
            ready = false;
            return;
        }
        string memory rpc = vm.envOr("BOTCHAIN_RPC", string("https://rpc.botchain.ai"));
        vm.createSelectFork(rpc);
        address walletAddr = vm.envAddress("AGENT_WALLET_ADDRESS");
        vault = CustomerCreditVault(vaultAddr);
        wallet = AgentWallet(payable(walletAddr));
        ready = true;
    }

    modifier whenDeployed() {
        if (!ready) return;
        _;
    }

    function test_chainIsBotchain() public view whenDeployed {
        assertEq(block.chainid, 677, "not on BOT Chain mainnet");
    }

    function test_vaultHasCode() public view whenDeployed {
        assertGt(address(vault).code.length, 0, "no vault bytecode");
    }

    function test_walletHasCode() public view whenDeployed {
        assertGt(address(wallet).code.length, 0, "no wallet bytecode");
    }

    function test_usdcPinned() public view whenDeployed {
        console.log("usdc:", address(vault.usdc()));
        assertTrue(address(vault.usdc()) != address(0));
    }

    function test_adminIsDeployer() public view whenDeployed {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        assertTrue(vault.hasRole(vault.DEFAULT_ADMIN_ROLE(), deployer));
    }

    function test_readsWork() public view whenDeployed {
        console.log("totalAvailableLiability:", vault.totalAvailableLiability());
        console.log("totalReservedLiability:", vault.totalReservedLiability());
        console.log("unwithdrawnRevenue:", vault.unwithdrawnRevenue());
        console.log("wallet owner:", wallet.owner());
    }

    function test_pauseRevertsForStranger() public whenDeployed {
        vm.prank(address(0xdead));
        vm.expectRevert();
        vault.pause();
    }
}
