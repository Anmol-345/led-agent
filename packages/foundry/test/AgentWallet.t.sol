// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentWallet} from "../src/AgentWallet.sol";

contract AgentWalletTest is Test {
    AgentWallet wallet;
    address agent = address(0xA);

    function setUp() public {
        wallet = new AgentWallet(agent);
    }

    function test_ownerIsDeployer() public view {
        assertEq(wallet.owner(), address(this));
    }

    function test_agentIsSet() public view {
        assertEq(wallet.agent(), agent);
    }

    function test_onlyAuthorizedCanExecute() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert("unauthorized");
        wallet.execute(address(0), 0, "");
    }
}
