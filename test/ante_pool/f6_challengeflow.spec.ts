import { basicFixture, BasicFixture } from '../fixtures/basic.fixture';
import {
  evmSnapshot,
  evmRevert,
  blockTimestamp,
  evmIncreaseTime,
  calculateDecay,
  calculateTimestampDecay,
  expectAlmostEqual,
  evmSetNextBlockTimestamp,
} from '../helpers';

import * as constants from '../constants';

import hre from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider } = waffle;

import { expect } from 'chai';
import { IAntePool } from '../../typechain';

describe('Register and confirm challenge flow', function () {
  const wallets = provider.getWallets();
  const [staker, challenger, staker_2, challenger_2] = wallets;

  let deployment: BasicFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let localSnapshotId: string;
  let pool: IAntePool;
  let decayRate: number;

  before(async () => {
    deployment = await loadFixture(basicFixture);
    globalSnapshotId = await evmSnapshot();

    pool = deployment.oddBlockDeployment.pool;
    decayRate = Number(await pool.decayRate());
    await pool.connect(staker).stake(constants.ONE_ETH.mul(10), constants.ONE_DAY_IN_SECONDS);
    snapshotId = await evmSnapshot();
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
  });

  describe('registerChallenge', () => {
    before(async () => {
      localSnapshotId = await evmSnapshot();
    });

    beforeEach(async () => {
      await evmRevert(localSnapshotId);
      localSnapshotId = await evmSnapshot();
    });

    it('reverts if amount is below minimum', async () => {
      await expect(pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(101))).to.be.revertedWith(
        'ANTE: Challenger must stake more than minChallengerStake'
      );
    });

    it('does not update claimableShares', async () => {
      expect((await pool.getChallengerInfo(challenger.address)).claimableShares).to.eq(0);
      await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
      expect((await pool.getChallengerInfo(challenger.address)).claimableShares).to.eq(0);
    });

    describe('with a new challenger', () => {
      it('properly sets startAmount', async () => {
        const challengeAmount = constants.ONE_ETH.div(10);

        await pool.connect(challenger).registerChallenge(challengeAmount);
        expect((await pool.getChallengerInfo(challenger.address)).startAmount).to.equal(challengeAmount);
      });
      it('properly sets lastStakedTimestamp', async () => {
        const now = (await blockTimestamp()) + 1;
        await evmSetNextBlockTimestamp(now);
        await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
        expect((await pool.getChallengerInfo(challenger.address)).lastStakedTimestamp).to.equal(now);
      });
      it('updates numUsers properly', async () => {
        const challengerInfo = await pool.challengerInfo();

        await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
        expect((await pool.challengerInfo()).numUsers).to.equal(challengerInfo.numUsers.add(1));

        await pool.connect(challenger_2).registerChallenge(constants.ONE_ETH.div(9));
        expect((await pool.challengerInfo()).numUsers).to.equal(challengerInfo.numUsers.add(2));
      });
      it('updates totalAmount properly', async () => {
        const challengeAmount = constants.ONE_ETH.div(10);
        expect(await pool.getTotalChallengerStaked()).to.equal(0);
        await pool.connect(challenger).registerChallenge(challengeAmount);

        expect(await pool.getTotalChallengerStaked()).to.equal(challengeAmount);
      });
    });

    describe('with an existing challenger', () => {
      let initialRegisterTimestamp: number;
      let initialConfirmTimestamp: number;
      beforeEach(async () => {
        await pool.connect(challenger).registerChallenge(constants.HALF_ETH);
        initialRegisterTimestamp = await blockTimestamp();
        initialConfirmTimestamp = initialRegisterTimestamp + constants.CHALLENGER_TIMESTAMP_DELAY * 200;
        await evmSetNextBlockTimestamp(initialConfirmTimestamp);
        await pool.connect(challenger).confirmChallenge();
      });
      it('properly updates startAmount', async () => {
        const challengeAmount = constants.ONE_ETH.div(10);
        const initialChallengeAmount = constants.HALF_ETH;
        expect((await pool.getChallengerInfo(challenger.address)).startAmount).to.equal(initialChallengeAmount);

        const registerTimestamp = (await blockTimestamp()) + 1;

        const { totalDecay: decay1 } = calculateDecay(
          initialChallengeAmount,
          registerTimestamp - initialRegisterTimestamp - 1
        );
        await evmSetNextBlockTimestamp(registerTimestamp);
        await pool.connect(challenger).registerChallenge(challengeAmount);

        const { totalDecay: decay2 } = calculateDecay(initialChallengeAmount.sub(decay1), 1);

        expectAlmostEqual(
          (await pool.getChallengerInfo(challenger.address)).startAmount,
          initialChallengeAmount.sub(decay1).sub(decay2).add(challengeAmount),
          constants.WEI_ROUNDING_ERROR_TOLERANCE
        );
      });
      it('properly updates lastStakedTimestamp', async () => {
        const previousLastStakedTimestamp = (await pool.getChallengerInfo(challenger.address)).lastStakedTimestamp;
        const registerTimestamp = (await blockTimestamp()) + 10;
        await evmSetNextBlockTimestamp(registerTimestamp);
        await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
        expect((await pool.getChallengerInfo(challenger.address)).lastStakedTimestamp).to.equal(registerTimestamp);
        expect(registerTimestamp).to.be.gt(previousLastStakedTimestamp);
      });
      it('updates totalAmount properly', async () => {
        const challengeAmount = constants.ONE_ETH.div(10);
        const initialChallengeAmount = constants.HALF_ETH;

        const expectedDecay1 = calculateDecay(
          initialChallengeAmount,
          initialConfirmTimestamp - initialRegisterTimestamp
        ).totalDecay;

        const expected1 = initialChallengeAmount.sub(expectedDecay1);
        expect(await pool.getTotalChallengerStaked()).to.equal(expected1);
        const registerTimestamp = (await blockTimestamp()) + 1;
        await evmSetNextBlockTimestamp(registerTimestamp);
        await pool.connect(challenger).registerChallenge(challengeAmount);

        const expectedDecay2 = calculateDecay(expected1, 1).totalDecay;

        const expected = challengeAmount.add(initialChallengeAmount).sub(expectedDecay1).sub(expectedDecay2);
        expect(await pool.getTotalChallengerStaked()).to.equal(expected);
      });
      it('does not update numUsers', async () => {
        const challengerInfo = await pool.challengerInfo();

        await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
        expect((await pool.challengerInfo()).numUsers).to.equal(challengerInfo.numUsers);
      });
    });
  });
  describe('confirmChallenge', () => {
    before(async () => {
      localSnapshotId = await evmSnapshot();
    });

    beforeEach(async () => {
      await evmRevert(localSnapshotId);
      localSnapshotId = await evmSnapshot();
    });

    it('can confirm challenge after MIN_CHALLENGER_DELAY has passed', async () => {
      await pool.connect(challenger).registerChallenge(constants.HALF_ETH);
      const registerTimestamp = await blockTimestamp();
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await pool.connect(challenger).confirmChallenge();
      const confirmTimestamp = await blockTimestamp();
      const confirmDelay = confirmTimestamp - registerTimestamp;
      expect(confirmDelay).gte(constants.CHALLENGER_TIMESTAMP_DELAY);

      const expectedDecay = calculateTimestampDecay(constants.HALF_ETH, decayRate, confirmDelay);
      const expected = constants.HALF_ETH.sub(expectedDecay);
      expectAlmostEqual(
        await pool.getTotalChallengerEligibleBalance(),
        expected,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
    });

    it('reverts if sender is not an existing challenger', async () => {
      await expect(pool.connect(challenger_2).confirmChallenge()).to.be.revertedWith(
        'ANTE: Only an existing challenger can confirm'
      );
    });

    it('cannot confirm challenge before MIN_CHALLENGER_DELAY has passed', async () => {
      await pool.connect(challenger).registerChallenge(constants.HALF_ETH);
      const registerTimestamp = await blockTimestamp();
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY / 2);
      await expect(pool.connect(challenger).confirmChallenge()).to.be.revertedWith(
        `ANTE: Challenger must wait at least MIN_CHALLENGER_DELAY after registering a challenge.`
      );
      const confirmRevertTimestamp = await blockTimestamp();
      const confirmDelay = confirmRevertTimestamp - registerTimestamp;
      expect(confirmDelay).lte(constants.CHALLENGER_TIMESTAMP_DELAY);

      expect(await pool.getTotalChallengerEligibleBalance()).to.equal(0);
    });

    it('correctly sets claimableShares', async () => {
      expect((await pool.getChallengerInfo(challenger.address)).claimableShares).to.eq(0);
      const challengeAmount = constants.ONE_ETH.div(10);
      await pool.connect(challenger).registerChallenge(challengeAmount);
      const firstChallengeTimestamp = await blockTimestamp();
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await pool.connect(challenger).confirmChallenge();
      const firstConfirmTimestamp = await blockTimestamp();
      const expectedDecay = calculateTimestampDecay(
        challengeAmount,
        decayRate,
        firstConfirmTimestamp - firstChallengeTimestamp
      );
      const expected = challengeAmount.sub(expectedDecay);
      expectAlmostEqual(
        (await pool.getChallengerInfo(challenger.address)).claimableShares,
        expected,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
    });

    it('correctly updates claimableShares after multiple challenges', async () => {
      expect((await pool.getChallengerInfo(challenger.address)).claimableShares).to.eq(0);
      const challengeAmount = constants.ONE_ETH.div(10);

      await pool.connect(challenger).registerChallenge(challengeAmount);
      const firstChallengeTimestamp = await blockTimestamp();

      await evmSetNextBlockTimestamp(firstChallengeTimestamp + constants.CHALLENGER_TIMESTAMP_DELAY);
      await pool.connect(challenger).confirmChallenge();
      const firstConfirmTimestamp = await blockTimestamp();

      const expectedDecay1 = calculateTimestampDecay(
        challengeAmount,
        decayRate,
        firstConfirmTimestamp - firstChallengeTimestamp
      );
      const expected1 = challengeAmount.sub(expectedDecay1);
      expectAlmostEqual(
        (await pool.getChallengerInfo(challenger.address)).claimableShares,
        expected1,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );

      const secondRegisterTimestamp = (await blockTimestamp()) + 1;
      await evmSetNextBlockTimestamp(secondRegisterTimestamp);
      await pool.connect(challenger).registerChallenge(challengeAmount);

      const secondConfirmTimestamp = secondRegisterTimestamp + constants.CHALLENGER_TIMESTAMP_DELAY;
      await evmSetNextBlockTimestamp(secondConfirmTimestamp);
      await pool.connect(challenger).confirmChallenge();

      const expected1DecayAfterRegister2 = calculateTimestampDecay(expected1, decayRate, 1);

      const challengedWithDecay = expected1.sub(expected1DecayAfterRegister2).add(challengeAmount);
      const expectedDecay2 = calculateTimestampDecay(
        challengedWithDecay,
        decayRate,
        secondConfirmTimestamp - secondRegisterTimestamp
      );

      const expected2 = challengedWithDecay.sub(expectedDecay2);
      expectAlmostEqual(
        (await pool.getChallengerInfo(challenger.address)).claimableShares,
        expected2,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
    });
  });
});
