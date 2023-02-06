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

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../interfaces/IAntePool.sol";
import "../AnteTest.sol";

/// @title Ante Pool contract states matches their ETH balance
/// @notice Connects to already deployed Ante Pools to check them
contract AntePoolTest is AnteTest("Ante Pool contract state matches eth balance") {
    ERC20 public token;

    /// @param antePoolContracts array of Ante Pools to check against
    constructor(address[] memory antePoolContracts, address _tokenAddr) {
        testedContracts = antePoolContracts;
        protocolName = "Ante";
        token = ERC20(_tokenAddr);
    }

    /// @notice test checks if any Ante Pool's balance is less than supposed store values
    /// @return true if contract balance is greater than or equal to stored Ante Pool values
    function checkTestPasses() public view override returns (bool) {
        for (uint256 i = 0; i < testedContracts.length; i++) {
            IAntePool antePool = IAntePool(testedContracts[i]);
            // totalPaidOut should be 0 before test fails
            if (
                token.balanceOf(testedContracts[i]) <
                (antePool.getTotalChallengerStaked() +
                    antePool.getTotalStaked() +
                    antePool.getTotalPendingWithdraw() -
                    antePool.totalPaidOut())
            ) {
                return false;
            }
        }
        return true;
    }
}
