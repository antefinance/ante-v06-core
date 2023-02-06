// SPDX-License-Identifier: GPL-3.0-only

// ┏━━━┓━━━━━┏┓━━━━━━━━━┏━━━┓━━━━━━━━━━━━━━━━━━━━━━━
// ┃┏━┓┃━━━━┏┛┗┓━━━━━━━━┃┏━━┛━━━━━━━━━━━━━━━━━━━━━━━
// ┃┗━┛┃┏━┓━┗┓┏┛┏━━┓━━━━┃┗━━┓┏┓┏━┓━┏━━┓━┏━┓━┏━━┓┏━━┓
// ┃┏━┓┃┃┏┓┓━┃┃━┃┏┓┃━━━━┃┏━━┛┣┫┃┏┓┓┗━┓┃━┃┏┓┓┃┏━┛┃┏┓┃
// ┃┃ ┃┃┃┃┃┃━┃┗┓┃┃━┫━┏┓━┃┃━━━┃┃┃┃┃┃┃┗┛┗┓┃┃┃┃┃┗━┓┃┃━┫
// ┗┛ ┗┛┗┛┗┛━┗━┛┗━━┛━┗┛━┗┛━━━┗┛┗┛┗┛┗━━━┛┗┛┗┛┗━━┛┗━━┛
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../AnteTest.sol";
import "../interfaces/IAntePool.sol";

/// @title Ante doesn't lose 90% of its AVL Test
/// @notice Ante Test to check that tested Ante Pools don't lose 90% of their tokens from the time this test is deployed
contract AnteAVLDropTest is AnteTest("Ante doesnt lose 90% of its AVL") {
    uint256 public avlThreshold;
    IERC20 public token;

    /// @dev Array of contract addresses to test should be passed in when deploying
    /// @param _testedContracts array of addresses to Ante Pools to check
    constructor(address[] memory _testedContracts) {
        protocolName = "Ante";
        testedContracts = _testedContracts;
        token = IAntePool(_testedContracts[0]).token();

        // Calculate test failure threshold using 90% drop in total AVL at time of deploy
        avlThreshold = getCurrentAVL() / 10;
    }

    /// @notice checks if the total AVL across tested contracts is less than the failure threshold
    /// @return true if total balance across tested contracts is greater than or equal to avlThreshold
    function checkTestPasses() public view override returns (bool) {
        return getCurrentAVL() >= avlThreshold;
    }

    /// @notice sums up the current total AVL across tested contracts
    /// @return sum of current balances across tested contracts
    function getCurrentAVL() public view returns (uint256) {
        uint256 currentAVL;

        for (uint256 i = 0; i < testedContracts.length; i++) {
            currentAVL += token.balanceOf(testedContracts[i]);
        }

        return currentAVL;
    }
}
