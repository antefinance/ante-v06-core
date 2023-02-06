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

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/IAnteDecentralizedTrustScoreV1.sol";
import "./interfaces/IAntePool.sol";

/// @title Ante Decentralized Trust Score smart contract
/// @notice Deploys an AnteDecentralizedTrustScore determines the trust score of a Ante Pool
contract AnteDecentralizedTrustScoreV1 is
    IAnteDecentralizedTrustScoreV1,
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable
{
    function initialize() public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
    }

    /// @inheritdoc IAnteDecentralizedTrustScoreV1
    function getTrustScore(address _antePoolAddr) external view override returns (uint256) {
        IAntePool pool = IAntePool(_antePoolAddr);

        if (pool.pendingFailure()) {
            return 0;
        }

        uint256 support = pool.getTotalStaked() + pool.getTotalPendingWithdraw();

        uint256 tvl = support + pool.getTotalChallengerStaked();

        if (tvl == 0) {
            return 0;
        }

        return (support * 100) / tvl;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
