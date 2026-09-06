// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AgentWallet {
    address public owner;
    address public agent;

    event Executed(address indexed target, uint256 value, bytes data);

    modifier onlyAuthorized() {
        _onlyAuthorized();
        _;
    }

    function _onlyAuthorized() internal view {
        require(msg.sender == owner || msg.sender == agent, "unauthorized");
    }

    constructor(address _agent) {
        owner = msg.sender;
        agent = _agent;
    }

    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyAuthorized returns (bytes memory) {
        (bool ok, bytes memory result) = target.call{value: value}(data);
        require(ok, "call failed");
        emit Executed(target, value, data);
        return result;
    }

    receive() external payable {}
}
