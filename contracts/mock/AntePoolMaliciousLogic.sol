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

import "../interfaces/IAnteTest.sol";
import "../interfaces/IAntePoolFactory.sol";

/// @title Ante V0.6 Ante Pool malicious smart contract
/// @notice Deploys a malicious Ante Pool intended to prevent failures
contract AntePoolMaliciousLogic {
    IAnteTest public anteTest;
    uint256 public decayRate;
    uint256 public challengerPayoutRatio;
    uint256 public testAuthorRewardRate;
    address public factory;
    uint256 public numTimesVerified;
    uint256 public lastVerifiedBlock;
    uint256 public lastVerifiedTimestamp;
    address public verifier;
    IERC20 public token;

    /// @dev pool can only be initialized once
    bool internal _initialized = false;

    uint256 public lastUpdateBlock;

    uint256 public lastUpdateTimestamp;

    uint256 public minChallengerStake;

    uint256 public minSupporterStake;

    address immutable _this;

    modifier notInitialized() {
        require(!_initialized, "ANTE: Pool already initialized");
        _;
    }

    modifier onlyDelegate() {
        require(address(this) != _this, "ANTE: Only delegate calls are allowed.");
        _;
    }

    /// @dev Prevent the implementation contract from being initialized.
    /// It must be initialized only by delegated calls.
    /// pendingFailure set to true in order to avoid
    /// people staking in logic contract
    constructor() {
        _initialized = true;
        _this = address(this);
    }

    function initialize(
        IAnteTest _anteTest,
        IERC20 _token,
        uint256 _tokenMinimum,
        uint256 _decayRate,
        uint256 _payoutRatio,
        uint256 _testAuthorRewardRate
    ) external notInitialized {
        _initialized = true;

        factory = msg.sender;
        anteTest = _anteTest;
        token = _token;
        minChallengerStake = _tokenMinimum;
        testAuthorRewardRate = _testAuthorRewardRate;
        decayRate = _decayRate;
        challengerPayoutRatio = _payoutRatio;
        minSupporterStake = _tokenMinimum * _payoutRatio;
    }

    /*****************************************************
     * ================ USER INTERFACE ================= *
     *****************************************************/

    function checkTest() external {
        checkTestWithState("");
    }

    function checkTestWithState(bytes memory _testState) public {
        bytes32 configHash = keccak256(
            abi.encodePacked(
                address(anteTest),
                address(token),
                minChallengerStake,
                challengerPayoutRatio,
                decayRate,
                testAuthorRewardRate
            )
        );
        IAntePoolFactory(factory).checkTestWithState(_testState, msg.sender, configHash);
    }

    function updateVerifiedState(address _verifier) public {}

    function updateFailureState(address _verifier) public {
        revert("ANTE: Prevent failure");
    }

    /*****************************************************
     * ================ VIEW FUNCTIONS ================= *
     *****************************************************/

    function pendingFailure() public view returns (bool) {
        return IAntePoolFactory(factory).hasTestFailed(address(anteTest));
    }

    function getCheckTestAllowedBlock(address _user) external view returns (uint256) {
        return 0;
    }

    function getUserStartAmount(address _user, bool isChallenger) external view returns (uint256) {
        return 1;
    }
}
