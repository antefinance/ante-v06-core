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
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./interfaces/IAnteTest.sol";
import "./interfaces/IAntePool.sol";
import "./interfaces/IAntePoolFactory.sol";

/// @title Ante V0.6 Ante Pool smart contract
/// @notice Deploys an Ante Pool and connects with the Ante Test, manages pools and interactions with users
contract AntePoolLogic is IAntePool, ReentrancyGuard {
    using Math for uint256;
    using Address for address;
    using SafeERC20 for IERC20;

    /// @notice Side agnostic user info
    struct BalanceInfo {
        // How many tokens this user deposited
        uint256 startAmount;
        // How much decay this side of the pool accrued between (0, this user's
        // entry block), stored as a multiplier expressed as an 18-decimal
        // mantissa. For example, if this side of the pool accrued a decay of
        // 20% during this time period, we'd store 1.2e18 (staking side) or
        // 0.8e18 (challenger side)
        uint256 startDecayMultiplier;
    }

    /// @notice Info related to a single staker
    struct StakerInfo {
        // Amount and decay info;
        BalanceInfo balanceInfo;
        // When the user can unstake
        uint256 unlockTimestamp;
    }

    /// @notice Info related to a single challenger
    struct ChallengerInfo {
        // Staked amount and decay info;
        BalanceInfo balanceInfo;
        // Confirmed tokens amount and decay info;
        BalanceInfo claimableShares;
        // When the user last registered a challenge
        uint256 lastStakedTimestamp;
        // Block number of the last challenge for this user
        uint256 lastStakedBlock;
    }

    /// @notice Side agnostic pool info
    struct PoolSideInfo {
        // Number of users on this side of the pool.
        uint256 numUsers;
        // Amount staked across all users on this side of the pool,, as of
        // `lastUpdateTimestamp`.
        uint256 totalAmount;
        // How much decay this side of the pool accrued between (0,
        // lastUpdateTimestamp), stored as a multiplier expressed as an 18-decimal
        // mantissa. For example, if this side of the pool accrued a decay of
        // 20% during this time period, we'd store 1.2e18 (staking side) or
        // 0.8e18 (challenger side).
        uint256 decayMultiplier;
    }

    /// @notice Info related to eligible challengers
    struct ChallengerEligibilityInfo {
        uint256 totalShares;
    }

    /// @notice Info related to stakers who are currently withdrawing
    struct StakerWithdrawInfo {
        mapping(address => UserUnstakeInfo) userUnstakeInfo;
        uint256 totalAmount;
    }

    /// @notice Info related to a single withdrawing user
    struct UserUnstakeInfo {
        uint256 lastUnstakeTimestamp;
        uint256 amount;
    }

    /// @inheritdoc IAntePool
    IAnteTest public override anteTest;
    /// @inheritdoc IAntePool
    uint256 public override decayRate;
    /// @inheritdoc IAntePool
    uint256 public override challengerPayoutRatio;
    /// @inheritdoc IAntePool
    uint256 public override testAuthorRewardRate;
    /// @inheritdoc IAntePool
    address public override factory;
    /// @inheritdoc IAntePool
    uint256 public override numTimesVerified;
    /// @dev Percent of staked amount allotted for verifier bounty
    uint256 public constant VERIFIER_BOUNTY = 5;
    /// @inheritdoc IAntePool
    uint256 public override failedBlock;
    /// @inheritdoc IAntePool
    uint256 public override failedTimestamp;
    /// @inheritdoc IAntePool
    uint256 public override lastVerifiedBlock;
    /// @inheritdoc IAntePool
    uint256 public override lastVerifiedTimestamp;
    /// @inheritdoc IAntePool
    address public override verifier;
    /// @inheritdoc IAntePool
    uint256 public override numPaidOut;
    /// @inheritdoc IAntePool
    uint256 public override totalPaidOut;
    /// @inheritdoc IAntePool
    IERC20 public override token;
    /// @inheritdoc IAntePool
    bool public override isDecaying;

    /// @dev pool can only be initialized once
    bool internal _initialized = false;
    /// @dev Bounty amount, set when test fails
    uint256 internal _bounty;
    /// @dev Total staked value, after bounty is removed
    uint256 internal _remainingStake;
    /// @dev
    uint256 internal _authorReward;

    /// @dev Number of blocks a challenger must be staking before they are
    /// eligible for payout on test failure
    uint8 public constant CHALLENGER_BLOCK_DELAY = 12;

    /// @dev Maximum test author reward rate (x% of decay rate) that can be set for this pool
    uint256 public constant MAX_AUTHOR_REWARD_RATE = 10;

    /// @dev Minimum annual challenger decay rate (x%) that can be set for this pool
    uint256 public constant MIN_ANNUAL_DECAY_RATE = 5;

    /// @dev Maximum annual challenger decay rate (x%) that can be set for this pool
    uint256 public constant MAX_ANNUAL_DECAY_RATE = 600;

    /// @dev Minimum challenger payout ratio that can be set for this pool
    uint256 public constant MIN_CHALLENGER_PAYOUT_RATIO = 2;

    /// @dev Maximum challenger payout ratio that can be set for this pool
    uint256 public constant MAX_CHALLENGER_PAYOUT_RATIO = 20;

    /// @dev Time after initiating withdraw before staker can finally withdraw capital,
    /// starts when staker initiates the unstake action
    uint256 public constant UNSTAKE_DELAY = 24 hours;

    /// @dev Convenience constant for determining time interval
    /// multiplier for annual decay rate
    uint256 public constant ONE_YEAR = 365 days;

    /// @dev Minimum time commitment for staking before the staker
    /// can initiate the unstake action
    uint256 public constant MIN_STAKE_COMMITMENT = 24 hours;

    /// @dev Maximum time commitment for staking before the staker
    /// can initiate the unstake action
    uint256 public constant MAX_STAKE_COMMITMENT = 730 days;

    /// @dev Number of seconds a challenger must be staking before they can
    /// confirm to be eligible for payout on test failure
    uint256 public constant MIN_CHALLENGER_DELAY = 180 seconds;

    /// @dev convenience constant for 1 ether worth of wei
    uint256 private constant ONE = 1e18;

    /// @inheritdoc IAntePool
    PoolSideInfo public override stakingInfo;
    /// @inheritdoc IAntePool
    PoolSideInfo public override challengerInfo;
    /// @inheritdoc IAntePool
    ChallengerEligibilityInfo public override eligibilityInfo;
    /// @dev All addresses currently challenging the Ante Test
    mapping(address => ChallengerInfo) private challengers;
    /// @dev All addresses currently staking the Ante Test
    mapping(address => StakerInfo) private stakers;
    /// @inheritdoc IAntePool
    StakerWithdrawInfo public override withdrawInfo;

    /// @inheritdoc IAntePool
    uint256 public override lastUpdateBlock;

    /// @inheritdoc IAntePool
    uint256 public override lastUpdateTimestamp;

    /// @inheritdoc IAntePool
    uint256 public override minChallengerStake;

    /// @inheritdoc IAntePool
    uint256 public override minSupporterStake;

    address immutable _this;

    /// @notice Modifier function to make sure test hasn't failed yet
    modifier testNotFailed() {
        _testNotFailed();
        _;
    }

    modifier notInitialized() {
        require(!_initialized, "ANTE: Pool already initialized");
        _;
    }

    modifier altersDecayState() {
        _;
        if (!isDecaying && _canDecay()) {
            isDecaying = true;
            emit DecayStarted();
        } else if (isDecaying && !_canDecay()) {
            isDecaying = false;
            emit DecayPaused();
        }
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

    /// @inheritdoc IAntePool
    function initialize(
        IAnteTest _anteTest,
        IERC20 _token,
        uint256 _tokenMinimum,
        uint256 _decayRate,
        uint256 _payoutRatio,
        uint256 _testAuthorRewardRate
    ) external override notInitialized nonReentrant {
        require(address(msg.sender).isContract(), "ANTE: Factory must be a contract");
        require(address(_anteTest).isContract(), "ANTE: AnteTest must be a smart contract");
        // Check that anteTest has checkTestPasses function and that it currently passes
        // place check here to minimize reentrancy risk - most external function calls are locked
        // while pendingFailure is true
        require(
            _testAuthorRewardRate <= MAX_AUTHOR_REWARD_RATE,
            "ANTE: Reward rate cannot be greater than MAX_AUTHOR_REWARD_RATE"
        );
        require(
            _decayRate >= MIN_ANNUAL_DECAY_RATE && _decayRate <= MAX_ANNUAL_DECAY_RATE,
            "ANTE: Decay rate must be between MIN_ANNUAL_DECAY_RATE and MAX_ANNUAL_DECAY_RATE"
        );
        require(
            _payoutRatio >= MIN_CHALLENGER_PAYOUT_RATIO && _payoutRatio <= MAX_CHALLENGER_PAYOUT_RATIO,
            "ANTE: Challenger payout ratio must be between MIN_CHALLENGER_PAYOUT_RATIO and MAX_CHALLENGER_PAYOUT_RATIO"
        );

        _initialized = true;

        factory = msg.sender;
        stakingInfo.decayMultiplier = ONE;
        challengerInfo.decayMultiplier = ONE;
        lastUpdateBlock = block.number;
        anteTest = _anteTest;
        token = _token;
        minChallengerStake = _tokenMinimum;
        testAuthorRewardRate = _testAuthorRewardRate;
        decayRate = _decayRate;
        challengerPayoutRatio = _payoutRatio;
        minSupporterStake = _tokenMinimum * _payoutRatio;
        isDecaying = false;

        require(_anteTest.checkTestPasses(), "ANTE: AnteTest does not implement checkTestPasses or test fails");
    }

    /*****************************************************
     * ================ USER INTERFACE ================= *
     *****************************************************/
    /// @inheritdoc IAntePool
    /// @dev Stake `amount` for at least `commitTime` seconds
    function stake(uint256 amount, uint256 commitTime) external override onlyDelegate testNotFailed altersDecayState {
        require(amount >= minSupporterStake, "ANTE: Supporter must stake more than minSupporterStake");
        require(commitTime >= MIN_STAKE_COMMITMENT, "ANTE: Cannot commit stake for less than 24 hours");
        require(commitTime <= MAX_STAKE_COMMITMENT, "ANTE: Cannot commit stake for more than 730 days");
        uint256 unlockTimestamp = block.timestamp + commitTime;
        StakerInfo storage user = stakers[msg.sender];
        require(
            unlockTimestamp > user.unlockTimestamp,
            "ANTE: Cannot commit a stake that expires before the current time commitment"
        );
        updateDecay();
        PoolSideInfo storage side = stakingInfo;
        BalanceInfo storage balanceInfo = user.balanceInfo;
        user.unlockTimestamp = unlockTimestamp;
        // Calculate how much the user already has staked, including the
        // effects of any previously accrued decay.
        //   prevAmount = startAmount * decayMultipiler / startDecayMultiplier
        //   newAmount = amount + prevAmount
        if (balanceInfo.startAmount > 0) {
            balanceInfo.startAmount = amount + _storedBalance(balanceInfo, side.decayMultiplier);
        } else {
            balanceInfo.startAmount = amount;
            side.numUsers++;
        }
        side.totalAmount += amount;
        // Reset the startDecayMultiplier for this user, since we've updated
        // the startAmount to include any already-accrued decay.
        balanceInfo.startDecayMultiplier = side.decayMultiplier;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Stake(msg.sender, amount, commitTime);
    }

    ///@inheritdoc IAntePool
    function extendStakeLock(uint256 additionalTime) external override testNotFailed altersDecayState {
        require(additionalTime >= MIN_STAKE_COMMITMENT, "ANTE: Additional time must be greater than 24 hours");
        require(additionalTime <= MAX_STAKE_COMMITMENT, "ANTE: Additional time must be less than 730 days");
        StakerInfo storage user = stakers[msg.sender];
        BalanceInfo storage balanceInfo = user.balanceInfo;
        require(balanceInfo.startAmount > 0, "ANTE: Only an existing staker can extend the stake lock");
        uint256 currentUnlockTime = user.unlockTimestamp < block.timestamp ? block.timestamp : user.unlockTimestamp;
        updateDecay();

        // If the previous lock is expired, add additionalTime from now
        user.unlockTimestamp = currentUnlockTime + additionalTime;
        emit ExtendStake(msg.sender, additionalTime, user.unlockTimestamp);
    }

    ///@inheritdoc IAntePool
    function registerChallenge(uint256 amount) external override onlyDelegate testNotFailed altersDecayState {
        require(amount >= minChallengerStake, "ANTE: Challenger must stake more than minChallengerStake");
        updateDecay();
        uint256 newRatio = stakingInfo.totalAmount / (challengerInfo.totalAmount + amount);
        require(newRatio >= challengerPayoutRatio, "ANTE: Challenge amount exceeds maximum challenge ratio.");

        PoolSideInfo storage side = challengerInfo;
        ChallengerInfo storage user = challengers[msg.sender];
        BalanceInfo storage balanceInfo = user.balanceInfo;

        // Calculate how much the user already has challenger, including the
        // effects of any previously accrued decay.
        //   prevAmount = startAmount * decayMultipiler / startDecayMultiplier
        //   newAmount = amount + prevAmount
        if (balanceInfo.startAmount > 0) {
            balanceInfo.startAmount = amount + _storedBalance(balanceInfo, side.decayMultiplier);
        } else {
            balanceInfo.startAmount = amount;
            side.numUsers++;
        }
        user.lastStakedTimestamp = block.timestamp;
        user.lastStakedBlock = block.number;

        side.totalAmount += amount;

        // Reset the startDecayMultiplier for this user, since we've updated
        // the startAmount to include any already-accrued decay.
        balanceInfo.startDecayMultiplier = side.decayMultiplier;

        token.safeTransferFrom(msg.sender, address(this), amount);
        emit RegisterChallenge(msg.sender, amount);
    }

    ///@inheritdoc IAntePool
    function confirmChallenge() external override testNotFailed altersDecayState {
        ChallengerInfo storage user = challengers[msg.sender];
        BalanceInfo storage balanceInfo = user.balanceInfo;
        BalanceInfo storage claimableShares = user.claimableShares;
        require(balanceInfo.startAmount > 0, "ANTE: Only an existing challenger can confirm");
        require(
            user.lastStakedTimestamp <= block.timestamp - MIN_CHALLENGER_DELAY,
            "ANTE: Challenger must wait at least MIN_CHALLENGER_DELAY after registering a challenge."
        );
        updateDecay();
        uint256 challengerBalance = _storedBalance(balanceInfo, challengerInfo.decayMultiplier);
        uint256 previousShares = _storedBalance(claimableShares, challengerInfo.decayMultiplier);
        uint256 confirmingShares = challengerBalance - previousShares;
        claimableShares.startAmount = challengerBalance;
        claimableShares.startDecayMultiplier = challengerInfo.decayMultiplier;
        eligibilityInfo.totalShares += confirmingShares;
        emit ConfirmChallenge(msg.sender, confirmingShares);
    }

    /// @inheritdoc IAntePool
    /// @dev Unstake `amount` on the side given by `isChallenger`.
    function unstake(uint256 amount, bool isChallenger) external override testNotFailed nonReentrant altersDecayState {
        require(amount > 0, "ANTE: Cannot unstake 0.");
        require(
            isChallenger || getUnstakeAllowedTime(msg.sender) <= block.timestamp,
            "ANTE: Staker cannot unstake before commited time"
        );

        updateDecay();

        PoolSideInfo storage side = isChallenger ? challengerInfo : stakingInfo;

        BalanceInfo storage balanceInfo = isChallenger
            ? challengers[msg.sender].balanceInfo
            : stakers[msg.sender].balanceInfo;
        _unstake(amount, isChallenger, side, balanceInfo);
    }

    /// @inheritdoc IAntePool
    function unstakeAll(bool isChallenger) external override nonReentrant altersDecayState {
        if (isChallenger) {
            // Prevent challengers (isChallenger=true) moving forward if test has failed.
            _testNotFailed();
        } else {
            // Allow stakers (isChallenger = false) to unstake all if test has failed and there are no challengers
            require(
                !pendingFailure() || challengerInfo.numUsers == 0,
                pendingFailure() ? "ANTE: Test already failed." : "ANTE: Cannot unstake"
            );
            require(
                getUnstakeAllowedTime(msg.sender) <= block.timestamp,
                "ANTE: Staker cannot unstake before commited time"
            );
        }

        updateDecay();

        PoolSideInfo storage side = isChallenger ? challengerInfo : stakingInfo;

        BalanceInfo storage balanceInfo = isChallenger
            ? challengers[msg.sender].balanceInfo
            : stakers[msg.sender].balanceInfo;

        uint256 amount = _storedBalance(balanceInfo, side.decayMultiplier);
        require(amount > 0, "ANTE: Nothing to unstake");

        _unstake(amount, isChallenger, side, balanceInfo);
    }

    /// @inheritdoc IAntePool
    function withdrawStake() external override nonReentrant {
        // Allow stakers to withdraw stake if test has failed and there are no challengers
        require(!pendingFailure() || challengerInfo.numUsers == 0, "ANTE: Cannot withdraw");

        UserUnstakeInfo storage unstakeUser = withdrawInfo.userUnstakeInfo[msg.sender];

        require(
            unstakeUser.lastUnstakeTimestamp < block.timestamp - UNSTAKE_DELAY,
            "ANTE: must wait 24 hours to withdraw stake"
        );
        require(unstakeUser.amount > 0, "ANTE: Nothing to withdraw");

        uint256 amount = unstakeUser.amount;
        withdrawInfo.totalAmount -= amount;
        unstakeUser.amount = 0;

        token.safeTransfer(msg.sender, amount);

        emit WithdrawStake(msg.sender, amount);
    }

    /// @inheritdoc IAntePool
    function cancelPendingWithdraw() external override testNotFailed altersDecayState {
        UserUnstakeInfo storage unstakeUser = withdrawInfo.userUnstakeInfo[msg.sender];

        require(unstakeUser.amount > 0, "ANTE: No pending withdraw balance");
        uint256 amount = unstakeUser.amount;
        unstakeUser.amount = 0;

        updateDecay();

        BalanceInfo storage user = stakers[msg.sender].balanceInfo;
        if (user.startAmount > 0) {
            user.startAmount = amount + _storedBalance(user, stakingInfo.decayMultiplier);
        } else {
            user.startAmount = amount;
            stakingInfo.numUsers++;
        }
        stakingInfo.totalAmount += amount;
        user.startDecayMultiplier = stakingInfo.decayMultiplier;

        withdrawInfo.totalAmount -= amount;

        emit CancelWithdraw(msg.sender, amount);
    }

    /// @inheritdoc IAntePool
    function checkTest() external override testNotFailed {
        checkTestWithState("");
    }

    /// @inheritdoc IAntePool
    function checkTestWithState(bytes memory _testState) public override testNotFailed nonReentrant {
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

    /// @inheritdoc IAntePool
    function claim() external override nonReentrant {
        require(pendingFailure(), "ANTE: Test has not failed");

        ChallengerInfo storage user = challengers[msg.sender];
        require(user.balanceInfo.startAmount > 0, "ANTE: No Challenger Staking balance");

        uint256 amount = _calculateChallengerPayout(user, msg.sender);
        // Zero out the user so they can't claim again.
        user.balanceInfo.startAmount = 0;
        user.claimableShares.startAmount = 0;

        numPaidOut++;
        totalPaidOut += amount;

        token.safeTransfer(msg.sender, amount);
        emit ClaimPaid(msg.sender, amount);
    }

    /// @inheritdoc IAntePool
    function claimReward() external override nonReentrant altersDecayState {
        require(msg.sender == anteTest.testAuthor(), "ANTE: Only author can claim");

        updateDecay();

        require(_authorReward > 0, "ANTE: No reward");

        uint256 amount = _authorReward;
        _authorReward = 0;

        token.safeTransfer(msg.sender, amount);
        emit RewardPaid(msg.sender, amount);
    }

    /// @inheritdoc IAntePool
    function updateDecay() public override {
        (
            uint256 decayMultiplierThisUpdate,
            uint256 decayThisUpdate,
            uint256 decayForStakers,
            uint256 decayForAuthor
        ) = _computeDecay();

        lastUpdateBlock = block.number;
        lastUpdateTimestamp = block.timestamp;

        if (decayThisUpdate == 0) return;

        uint256 totalStaked = stakingInfo.totalAmount;
        uint256 totalChallengerStaked = challengerInfo.totalAmount;

        // update total accrued decay amounts for challengers
        // decayMultiplier for challengers = decayMultiplier for challengers * decayMultiplierThisUpdate
        // totalChallengerStaked = totalChallengerStaked - decayThisUpdate
        challengerInfo.decayMultiplier = challengerInfo.decayMultiplier.mulDiv(decayMultiplierThisUpdate, ONE);
        challengerInfo.totalAmount = totalChallengerStaked - decayThisUpdate;

        // Decay the total confirmed shares
        eligibilityInfo.totalShares = eligibilityInfo.totalShares.mulDiv(
            decayMultiplierThisUpdate,
            ONE,
            Math.Rounding.Up
        );

        // Update the new accrued decay amounts for stakers.
        //   totalStaked_new = totalStaked_old + decayThisUpdate
        //   decayMultipilerThisUpdate = totalStaked_new / totalStaked_old
        //   decayMultiplier_staker = decayMultiplier_staker * decayMultiplierThisUpdate
        uint256 totalStakedNew = totalStaked + decayForStakers;

        stakingInfo.decayMultiplier = stakingInfo.decayMultiplier.mulDiv(totalStakedNew, totalStaked);
        stakingInfo.totalAmount = totalStakedNew;

        _authorReward += decayForAuthor;
        emit DecayUpdated(decayThisUpdate, challengerInfo.decayMultiplier, stakingInfo.decayMultiplier);
    }

    /// @inheritdoc IAntePool
    function updateVerifiedState(address _verifier) public override testNotFailed {
        require(msg.sender == factory, "ANTE: Must be called by factory");
        numTimesVerified++;
        lastVerifiedBlock = block.number;
        lastVerifiedTimestamp = block.timestamp;
        emit TestChecked(_verifier);
    }

    /// @inheritdoc IAntePool
    function updateFailureState(address _verifier) public override {
        require(msg.sender == factory, "ANTE: Must be called by factory");
        _updateFailureState(_verifier);
    }

    /*****************************************************
     * ================ VIEW FUNCTIONS ================= *
     *****************************************************/

    /// @inheritdoc IAntePool
    function pendingFailure() public view override returns (bool) {
        return IAntePoolFactory(factory).hasTestFailed(address(anteTest));
    }

    /// @inheritdoc IAntePool
    function getTotalChallengerStaked() external view override returns (uint256) {
        return challengerInfo.totalAmount;
    }

    /// @inheritdoc IAntePool
    function getTotalStaked() external view override returns (uint256) {
        return stakingInfo.totalAmount;
    }

    /// @inheritdoc IAntePool
    function getTotalPendingWithdraw() external view override returns (uint256) {
        return withdrawInfo.totalAmount;
    }

    /// @inheritdoc IAntePool
    function getTotalChallengerEligibleBalance() external view override returns (uint256) {
        return eligibilityInfo.totalShares;
    }

    /// @inheritdoc IAntePool
    function getChallengerInfo(
        address challenger
    )
        external
        view
        override
        returns (
            uint256 startAmount,
            uint256 lastStakedTimestamp,
            uint256 claimableShares,
            uint256 claimableSharesStartMultiplier
        )
    {
        ChallengerInfo storage user = challengers[challenger];
        startAmount = user.balanceInfo.startAmount;
        lastStakedTimestamp = user.lastStakedTimestamp;
        claimableShares = user.claimableShares.startAmount;
        claimableSharesStartMultiplier = user.claimableShares.startDecayMultiplier;
    }

    /// @inheritdoc IAntePool
    function getChallengerPayout(address challenger) external view override returns (uint256) {
        ChallengerInfo storage user = challengers[challenger];
        require(user.balanceInfo.startAmount > 0, "ANTE: No Challenger Staking balance");

        // If called before test failure returns an estimate
        if (pendingFailure()) {
            return _calculateChallengerPayout(user, challenger);
        } else {
            uint256 amount = _storedBalance(user.balanceInfo, challengerInfo.decayMultiplier);
            uint256 claimableShares = _storedBalance(user.claimableShares, challengerInfo.decayMultiplier);
            uint256 bounty = getVerifierBounty();
            uint256 totalStake = stakingInfo.totalAmount + withdrawInfo.totalAmount - bounty;

            return amount + totalStake.mulDiv(claimableShares, eligibilityInfo.totalShares);
        }
    }

    /// @inheritdoc IAntePool
    function getStoredBalance(address _user, bool isChallenger) external view override returns (uint256) {
        (uint256 decayMultiplierThisUpdate, , uint256 decayForStakers, ) = _computeDecay();

        BalanceInfo storage user = isChallenger ? challengers[_user].balanceInfo : stakers[_user].balanceInfo;

        if (user.startAmount == 0) return 0;

        uint256 decayMultiplier;

        if (isChallenger) {
            decayMultiplier = challengerInfo.decayMultiplier.mulDiv(decayMultiplierThisUpdate, ONE);
        } else {
            uint256 totalStaked = stakingInfo.totalAmount;
            uint256 totalStakedNew = totalStaked + decayForStakers;
            decayMultiplier = stakingInfo.decayMultiplier.mulDiv(totalStakedNew, totalStaked);
        }

        return _storedBalance(user, decayMultiplier);
    }

    /// @inheritdoc IAntePool
    function getPendingWithdrawAmount(address _user) external view override returns (uint256) {
        return withdrawInfo.userUnstakeInfo[_user].amount;
    }

    /// @inheritdoc IAntePool
    function getPendingWithdrawAllowedTime(address _user) external view override returns (uint256) {
        UserUnstakeInfo storage user = withdrawInfo.userUnstakeInfo[_user];
        require(user.amount > 0, "ANTE: nothing to withdraw");

        return user.lastUnstakeTimestamp + UNSTAKE_DELAY;
    }

    /// @inheritdoc IAntePool
    function getUnstakeAllowedTime(address _user) public view override returns (uint256) {
        return stakers[_user].unlockTimestamp;
    }

    /// @inheritdoc IAntePool
    function getCheckTestAllowedBlock(address _user) external view override returns (uint256) {
        return challengers[_user].lastStakedBlock + CHALLENGER_BLOCK_DELAY;
    }

    /// @inheritdoc IAntePool
    function getUserStartAmount(address _user, bool isChallenger) external view override returns (uint256) {
        return isChallenger ? challengers[_user].balanceInfo.startAmount : stakers[_user].balanceInfo.startAmount;
    }

    /// @inheritdoc IAntePool
    function getUserStartDecayMultiplier(address _user, bool isChallenger) external view override returns (uint256) {
        return
            isChallenger
                ? challengers[_user].balanceInfo.startDecayMultiplier
                : stakers[_user].balanceInfo.startDecayMultiplier;
    }

    /// @inheritdoc IAntePool
    function getVerifierBounty() public view override returns (uint256) {
        uint256 totalStake = stakingInfo.totalAmount + withdrawInfo.totalAmount;
        return totalStake.mulDiv(VERIFIER_BOUNTY, 100);
    }

    /// @inheritdoc IAntePool
    function getTestAuthorReward() public view override returns (uint256) {
        (, , , uint256 decayForAuthor) = _computeDecay();
        return _authorReward + decayForAuthor;
    }

    /*****************************************************
     * =============== INTERNAL HELPERS ================ *
     *****************************************************/

    /// @notice Internal function activating the unstaking action for staker or challengers
    /// @param amount Amount to be removed in wei
    /// @param isChallenger True if user is a challenger
    /// @param side Corresponding staker or challenger pool info
    /// @param balanceInfo Info related to the user balance
    /// @dev If the user is a challenger the function the amount can be withdrawn
    /// immediately, if the user is a staker, the amount is moved to the withdraw
    /// info and then the 24 hour waiting period starts
    function _unstake(
        uint256 amount,
        bool isChallenger,
        PoolSideInfo storage side,
        BalanceInfo storage balanceInfo
    ) internal {
        // Calculate how much the user has available to unstake, including the
        // effects of any previously accrued decay.
        //   prevAmount = startAmount * decayMultiplier / startDecayMultiplier
        uint256 prevAmount = _storedBalance(balanceInfo, side.decayMultiplier);

        if (prevAmount == amount) {
            balanceInfo.startAmount = 0;
            balanceInfo.startDecayMultiplier = 0;
            side.numUsers--;

            // Remove from set of existing challengers
            if (isChallenger) {
                BalanceInfo storage claimableShares = challengers[msg.sender].claimableShares;
                uint256 sharesToRemove = _storedBalance(claimableShares, challengerInfo.decayMultiplier);
                eligibilityInfo.totalShares -= sharesToRemove;
                delete challengers[msg.sender];
            }
        } else {
            require(amount <= prevAmount, "ANTE: Withdraw request exceeds balance.");
            require(
                (isChallenger && (prevAmount - amount > minChallengerStake)) ||
                    (!isChallenger && (prevAmount - amount > minSupporterStake)),
                "ANTE: balance must be zero or greater than min"
            );
            balanceInfo.startAmount = prevAmount - amount;
            // Reset the startDecayMultiplier for this user, since we've updated
            // the startAmount to include any already-accrued decay.
            balanceInfo.startDecayMultiplier = side.decayMultiplier;

            if (isChallenger) {
                BalanceInfo storage claimableShares = challengers[msg.sender].claimableShares;
                // Use LIFO ordering for unstaking, if there is unconfirmed stake, unstake that first
                // The remaining amount to unstake detracts from the confirmed shares
                uint256 confirmedShares = _storedBalance(claimableShares, challengerInfo.decayMultiplier);
                uint256 unconfirmedShares = prevAmount - confirmedShares;

                uint256 confirmedSharesToRemove = amount - _min(unconfirmedShares, amount);
                claimableShares.startAmount = confirmedShares - confirmedSharesToRemove;
                claimableShares.startDecayMultiplier = challengerInfo.decayMultiplier;
                eligibilityInfo.totalShares -= confirmedSharesToRemove;
            }
        }
        side.totalAmount -= amount;

        if (isChallenger) token.safeTransfer(msg.sender, amount);
        else {
            // Just initiate the withdraw if staker
            UserUnstakeInfo storage unstakeUser = withdrawInfo.userUnstakeInfo[msg.sender];
            unstakeUser.lastUnstakeTimestamp = block.timestamp;
            unstakeUser.amount += amount;

            withdrawInfo.totalAmount += amount;
        }

        emit Unstake(msg.sender, amount, isChallenger);
    }

    /// @notice Computes the decay differences for staker and challenger pools
    /// @dev Function shared by getStoredBalance view function and internal
    /// decay computation
    /// @return decayMultiplierThisUpdate multiplier factor for this decay change
    /// @return decayThisUpdate amount of challenger value that's decayed in wei
    /// @return decayForStakers amount of challenger decay that goes to stakers in wei
    /// @return decayForAuthor amount of challenger decay that goes to the author in wei
    function _computeDecay()
        internal
        view
        returns (
            uint256 decayMultiplierThisUpdate,
            uint256 decayThisUpdate,
            uint256 decayForStakers,
            uint256 decayForAuthor
        )
    {
        decayMultiplierThisUpdate = ONE;
        decayThisUpdate = 0;
        decayForStakers = 0;
        decayForAuthor = 0;

        if (block.timestamp <= lastUpdateTimestamp) {
            return (decayMultiplierThisUpdate, decayThisUpdate, decayForStakers, decayForAuthor);
        }

        if (!_canDecay()) {
            return (decayMultiplierThisUpdate, decayThisUpdate, decayForStakers, decayForAuthor);
        }

        uint256 numSeconds = block.timestamp - lastUpdateTimestamp;

        // The rest of the function updates the new accrued decay amounts
        //   decayRateThisUpdate = ONE * numSeconds * (decayRate / 100) / ONE_YEAR_IN_SECONDS
        //   decayMultiplierThisUpdate = 1 - decayRateThisUpdate
        //   decayThisUpdate = totalChallengerStaked * decayRateThisUpdate
        uint256 decayRateThisUpdate = ONE.mulDiv(decayRate, 100).mulDiv(numSeconds, ONE_YEAR);

        uint256 totalChallengerStaked = challengerInfo.totalAmount;
        // Failsafe to avoid underflow when calculating decayMultiplierThisUpdate
        if (decayRateThisUpdate >= ONE) {
            decayMultiplierThisUpdate = 0;
            decayThisUpdate = totalChallengerStaked;
        } else {
            decayMultiplierThisUpdate = ONE - decayRateThisUpdate;
            decayThisUpdate = totalChallengerStaked.mulDiv(decayRateThisUpdate, ONE);
        }
        decayForAuthor = decayThisUpdate.mulDiv(testAuthorRewardRate, 100);
        decayForStakers = decayThisUpdate - decayForAuthor;
    }

    /// @notice Calculates individual challenger payout
    /// @param user ChallengerInfo for specified challenger
    /// @param challenger Address of challenger
    /// @dev This is only called after a test is failed, so it's calculated payouts
    /// are no longer estimates
    /// @return Payout amount for challenger in wei
    function _calculateChallengerPayout(
        ChallengerInfo storage user,
        address challenger
    ) internal view returns (uint256) {
        // Calculate this user's challenging balance.
        uint256 amount = _storedBalance(user.balanceInfo, challengerInfo.decayMultiplier);
        // Calculate how much of the staking pool this user gets, and add that
        // to the user's challenging balance.
        uint256 claimableShares = _storedBalance(user.claimableShares, challengerInfo.decayMultiplier);
        if (claimableShares > 0) {
            amount += claimableShares.mulDiv(_remainingStake, eligibilityInfo.totalShares);
        }
        return challenger == verifier ? amount + _bounty : amount;
    }

    /// @notice Get the stored balance held by user, including accrued decay
    /// @param balanceInfo BalanceInfo of specified user
    /// @param decayMultiplier decayMultiplier of the side where the user is located, either staker or challenger side
    /// @dev This includes accrued decay up to `lastUpdateBlock`
    /// @return Balance of the user in wei
    function _storedBalance(BalanceInfo storage balanceInfo, uint256 decayMultiplier) internal view returns (uint256) {
        if (balanceInfo.startAmount == 0) return 0;

        require(balanceInfo.startDecayMultiplier > 0, "ANTE: Invalid startDecayMultiplier");

        uint256 balance = balanceInfo.startAmount.mulDiv(decayMultiplier, balanceInfo.startDecayMultiplier);

        return balance;
    }

    /// @notice Updates the pool variables in order to reflect the failure state
    /// @param _verifier The address of who called the test verification
    function _updateFailureState(address _verifier) internal {
        updateDecay();
        verifier = _verifier;
        failedBlock = block.number;
        failedTimestamp = block.timestamp;
        isDecaying = false;

        // If the verifier is not a challenger there will be no bounty to remeed.
        // As such, all the funds will be remeemable by challengers.
        // This can happen if the pool is failed through the factory
        // when the underlying test was failed by another pool.
        if (challengers[_verifier].balanceInfo.startAmount == 0) {
            _bounty = 0;
        } else {
            _bounty = getVerifierBounty();
        }

        uint256 totalStake = stakingInfo.totalAmount + withdrawInfo.totalAmount;
        _remainingStake = totalStake - _bounty;

        emit DecayPaused();
        emit FailureOccurred(_verifier);
    }

    /// @notice Returns the minimum of 2 parameters
    /// @param a Value A
    /// @param b Value B
    /// @return Lower of a or b
    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /// @notice Checks if the test has not failed yet
    function _testNotFailed() internal view {
        require(!pendingFailure(), "ANTE: Test already failed.");
    }

    /// @notice Checks if the pool can decay
    /// Pool can decay only if there are stakers and challengers
    /// and if there are challenger funds to be decayed
    function _canDecay() internal view returns (bool) {
        return
            stakingInfo.numUsers > 0 &&
            challengerInfo.totalAmount > 0 &&
            challengerInfo.numUsers > 0 &&
            !pendingFailure();
    }
}
