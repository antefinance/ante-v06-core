import { BasicFixture } from '../fixtures/basic.fixture';
import { oneSupportChallengeFixture } from '../fixtures/oneSupportChallenge.fixture';
import {
  evmSnapshot,
  evmRevert,
  evmLastMinedBlockNumber,
  evmMineBlocks,
  triggerOddBlockTestFailure,
  calculateTimestampDecay,
  expectAlmostEqual,
  getExpectedCurrentChallengerBalance,
  getExpectedCurrentStakerBalance,
  getExpectedFutureStakerBalance,
  getExpectedFutureChallengerBalance,
  getExpectedFutureAuthorReward,
  blockTimestamp,
  evmSetNextBlockTimestamp,
  calculateDecay,
  evmIncreaseTime,
} from '../helpers';

import * as constants from '../constants';

import hre from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider } = waffle;

import { expect } from 'chai';
import { IAntePool } from '../../typechain';

describe('Decay Calculations', function () {
  const wallets = provider.getWallets();
  const [_1, _2, staker, challenger, staker_2] = wallets;

  let deployment: BasicFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let pool: IAntePool;

  before(async () => {
    deployment = await loadFixture(oneSupportChallengeFixture);
    globalSnapshotId = await evmSnapshot();
    snapshotId = await evmSnapshot();

    pool = deployment.oddBlockDeployment.pool;
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
  });

  describe('updateDecay', () => {
    it('updated the balances correctly after one day of decay', async () => {
      const startTimestamp = await blockTimestamp();
      const expectedChallengerBalance = await getExpectedCurrentChallengerBalance(challenger, pool);
      const expectedStakerBalance = await getExpectedCurrentStakerBalance(staker, pool);

      expectAlmostEqual(
        await pool.getStoredBalance(challenger.address, true),
        expectedChallengerBalance,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
      expectAlmostEqual(
        await pool.getStoredBalance(staker.address, false),
        expectedStakerBalance,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );

      const expectedAuthorReward = await getExpectedFutureAuthorReward(pool, constants.ONE_DAY_IN_SECONDS);
      const poolDecayRate = (await pool.decayRate()).toNumber();

      // advance 1 day and update decay
      await evmSetNextBlockTimestamp(startTimestamp + constants.ONE_DAY_IN_SECONDS);
      await pool.updateDecay();

      const oneDayDecay = calculateTimestampDecay(
        expectedChallengerBalance,
        poolDecayRate,
        constants.ONE_DAY_IN_SECONDS
      );
      const expectedStakerDecayShare = oneDayDecay.sub(expectedAuthorReward);

      expectAlmostEqual(
        await pool.getStoredBalance(challenger.address, true),
        expectedChallengerBalance.sub(oneDayDecay),
        2
      );
      expectAlmostEqual(
        await pool.getStoredBalance(staker.address, false),
        expectedStakerBalance.add(expectedStakerDecayShare),
        3
      );
    });

    it('updates lastUpdateBlock correctly', async () => {
      const lastMinedBlock = await evmLastMinedBlockNumber();
      expect(await pool.lastUpdateBlock()).to.be.lte(lastMinedBlock);

      // update pool and mine block
      await pool.updateDecay();

      expect(await pool.lastUpdateBlock()).to.equal(lastMinedBlock.add(1));
    });

    it('updates lastUpdateTimestamp correctly', async () => {
      const startTimestamp = await blockTimestamp();
      expect(await pool.lastUpdateTimestamp()).to.be.lte(startTimestamp);

      await evmSetNextBlockTimestamp(startTimestamp + constants.ONE_DAY_IN_SECONDS);
      // update pool and mine block
      await pool.updateDecay();

      expect(await pool.lastUpdateTimestamp()).to.equal(startTimestamp + constants.ONE_DAY_IN_SECONDS);
    });

    it('updates the totalAmount properly', async () => {
      const startTimestamp = await blockTimestamp();
      const startTotalStaked = await pool.getTotalStaked();
      const startTotalChallenged = await pool.getTotalChallengerStaked();
      const expectedAuthorReward = await getExpectedFutureAuthorReward(pool, constants.ONE_DAY_IN_SECONDS);

      // let some decay accumulate
      await evmSetNextBlockTimestamp(startTimestamp + constants.ONE_DAY_IN_SECONDS);
      await pool.updateDecay();
      const poolDecayRate = (await pool.decayRate()).toNumber();
      const oneDayDecay = calculateTimestampDecay(startTotalChallenged, poolDecayRate, constants.ONE_DAY_IN_SECONDS);
      const expectedStakerDecayShare = oneDayDecay.sub(expectedAuthorReward);

      expect(await pool.getTotalStaked()).to.equal(startTotalStaked.add(expectedStakerDecayShare));
      expect(await pool.getTotalChallengerStaked()).to.equal(startTotalChallenged.sub(oneDayDecay));
    });

    it('stops accruing decay after test failure', async () => {
      const startTimestamp = await blockTimestamp();
      await triggerOddBlockTestFailure(pool, challenger);

      const stakeAmount = await pool.getTotalStaked();
      const challengeAmount = await pool.getTotalChallengerStaked();

      // let some decay accumulate
      await evmSetNextBlockTimestamp(startTimestamp + constants.ONE_DAY_IN_SECONDS);

      await pool.updateDecay();
      // check that decay stopped updating
      expect(await pool.getTotalStaked()).to.equal(stakeAmount);
      expect(await pool.getTotalChallengerStaked()).to.equal(challengeAmount);
    });

    it("doesn't accumulate decay if there are no stakers", async () => {
      expect(await pool.getTotalStaked()).to.be.gt(0);

      const unstakeTime = (await pool.getUnstakeAllowedTime(staker.address)).toNumber();
      await evmSetNextBlockTimestamp(unstakeTime);
      await pool.connect(staker).unstakeAll(false);
      expect((await pool.stakingInfo()).numUsers).to.equal(0);

      const challengeAmount = await pool.getTotalChallengerStaked();

      await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS);
      await pool.updateDecay();

      expect(await pool.getTotalChallengerStaked()).to.equal(challengeAmount);
    });

    it('accumulate decay only while pool is decaying', async () => {
      const unstakeTime = (await pool.getUnstakeAllowedTime(staker.address)).toNumber();
      await evmSetNextBlockTimestamp(unstakeTime);
      await pool.connect(staker).unstakeAll(false);
      expect((await pool.stakingInfo()).numUsers).to.equal(0);
      expect(await pool.isDecaying()).to.equal(false);

      const challengeAmount = await pool.getTotalChallengerStaked();
      const decayResumedTime = unstakeTime + constants.ONE_DAY_IN_SECONDS;
      await evmSetNextBlockTimestamp(decayResumedTime);
      await pool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
      expect(await pool.isDecaying()).to.equal(true);

      const decayingPeriod = constants.ONE_DAY_IN_SECONDS;
      await evmSetNextBlockTimestamp(decayResumedTime + constants.ONE_DAY_IN_SECONDS);
      await pool.updateDecay();

      const decay = calculateDecay(challengeAmount, decayingPeriod).totalDecay;
      expect(await pool.getTotalChallengerStaked()).to.equal(challengeAmount.sub(decay));
    });

    it('emits DecayPaused when all stakers unstake', async () => {
      const unstakeTime = (await pool.getUnstakeAllowedTime(staker.address)).toNumber();
      await evmSetNextBlockTimestamp(unstakeTime);
      await expect(pool.connect(staker).unstakeAll(false)).to.emit(pool, 'DecayPaused');
    });

    it('emits DecayStarted when the number of stakers changes from 0 to 1', async () => {
      const unstakeTime = (await pool.getUnstakeAllowedTime(staker.address)).toNumber();
      await evmSetNextBlockTimestamp(unstakeTime);
      await pool.connect(staker).unstakeAll(false);

      await expect(pool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT)).to.emit(
        pool,
        'DecayStarted'
      );
    });

    it("doesn't emit DecayStarted on subsequent stakers", async () => {
      await expect(pool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT * 2)).to.not.emit(
        pool,
        'DecayStarted'
      );
    });
  });

  describe('getStoredBalance', () => {
    it('displays proper user balance without updateDecay call', async () => {
      const startTimestamp = await blockTimestamp();
      // let some decay accumulate
      const expectedSupporterBalance = await getExpectedFutureStakerBalance(staker, pool, constants.ONE_DAY_IN_SECONDS);
      const expectedChallengerBalance = await getExpectedFutureChallengerBalance(
        challenger,
        pool,
        constants.ONE_DAY_IN_SECONDS
      );

      await evmSetNextBlockTimestamp(startTimestamp + constants.ONE_DAY_IN_SECONDS);
      await evmMineBlocks(1);
      expectAlmostEqual(
        await pool.getStoredBalance(staker.address, false),
        expectedSupporterBalance,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
      expectAlmostEqual(
        await pool.getStoredBalance(challenger.address, true),
        expectedChallengerBalance,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
    });
  });

  describe('getPendingWithdrawAmount', () => {
    it("doesn't include decay in staker funds pending withdrawal", async () => {
      const startTime = await blockTimestamp();
      // unstake 0.5 tokens for first staker and add a second staker with a 1 token stake

      const unlockTime = (await pool.getUnstakeAllowedTime(staker.address)).toNumber() + 1;
      const elapsedTime = unlockTime - startTime;
      const expected = await getExpectedFutureStakerBalance(staker, pool, elapsedTime);
      await evmSetNextBlockTimestamp(unlockTime);
      await pool.connect(staker).unstake(constants.HALF_ETH, false);

      expectAlmostEqual(
        await pool.getStoredBalance(staker.address, false),
        expected.sub(constants.HALF_ETH),
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );

      await pool.connect(staker_2).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);

      const preDecayTime = await blockTimestamp();

      const expectedSupporterOneBalance = await getExpectedFutureStakerBalance(
        staker,
        pool,
        constants.ONE_DAY_IN_SECONDS
      );
      const expectedSupporterTwoBalance = await getExpectedFutureStakerBalance(
        staker_2,
        pool,
        constants.ONE_DAY_IN_SECONDS
      );
      // let some decay accumulate
      await evmSetNextBlockTimestamp(preDecayTime + constants.ONE_DAY_IN_SECONDS);
      await evmMineBlocks(1);

      const stakerOneNewBalance = await pool.getStoredBalance(staker.address, false);
      const stakerTwoNewBalance = await pool.getStoredBalance(staker_2.address, false);

      expectAlmostEqual(stakerOneNewBalance, expectedSupporterOneBalance, constants.WEI_ROUNDING_ERROR_TOLERANCE);
      expectAlmostEqual(stakerTwoNewBalance, expectedSupporterTwoBalance, constants.WEI_ROUNDING_ERROR_TOLERANCE);
      // no decay accumulates on pending withdraw amount
      expect(await pool.getPendingWithdrawAmount(staker.address)).to.equal(constants.HALF_ETH);
    });
  });
});
