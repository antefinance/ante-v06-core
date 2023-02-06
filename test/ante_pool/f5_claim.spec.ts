import { failedTestFixture } from '../fixtures/failedTest.fixture';
import { ConditionalTestFixture } from '../fixtures/conditionalTest.fixture';
import {
  evmSnapshot,
  evmRevert,
  evmMineBlocks,
  blockNumber,
  getExpectedChallengerPayoutWithoutBounty,
  evmIncreaseTime,
  expectAlmostEqual,
  givePoolAllowance,
} from '../helpers';
import * as constants from '../constants';

import hre from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider } = waffle;

import { expect } from 'chai';
import { AnteERC20, IAntePool } from '../../typechain';
import { multiPoolSameTest } from '../fixtures/multiPoolSameTest.fixture';

describe('Claim', function () {
  const wallets = provider.getWallets();
  const [_deployer, author, staker, challenger, staker2, challenger2, _staker3, challenger3] = wallets;

  let deployment: ConditionalTestFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let pool: IAntePool;
  let token: AnteERC20;

  before(async () => {
    // note: failure on this test has already been triggered by challenger
    // challenger3 is ineligible for payout of staker balances on claim
    // staker has their entire balance pending withdraw
    deployment = await loadFixture(failedTestFixture);
    globalSnapshotId = await evmSnapshot();
    snapshotId = await evmSnapshot();

    pool = deployment.conditionalTestDeployment.pool;
    token = deployment.token;
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
  });

  describe('claim', () => {
    it('staker, challenger, and pendingWithdraw balances do not change after test failure', async () => {
      const totalPendingWithdraw = await pool.getTotalPendingWithdraw();
      const totalStaked = await pool.getTotalStaked();
      const totalChallenged = await pool.getTotalChallengerStaked();

      const stakerTwoBal = await pool.getStoredBalance(staker2.address, false);
      const challengerBal = await pool.getStoredBalance(challenger.address, true);
      const stakerOnePendingWithdraw = await pool.getPendingWithdrawAmount(staker.address);

      await evmMineBlocks(10);

      expect(await pool.getTotalPendingWithdraw()).to.equal(totalPendingWithdraw);
      expect(await pool.getTotalStaked()).to.equal(totalStaked);
      expect(await pool.getTotalChallengerStaked()).to.equal(totalChallenged);
      expect(await pool.getStoredBalance(staker2.address, false)).to.equal(stakerTwoBal);
      expect(await pool.getStoredBalance(challenger.address, true)).to.equal(challengerBal);
      expect(await pool.getPendingWithdrawAmount(staker.address)).to.equal(stakerOnePendingWithdraw);
    });

    it('verifierBounty calculated properly', async () => {
      const totalAmount = (await pool.getTotalStaked()).add(await pool.getTotalPendingWithdraw());

      const bounty = totalAmount.mul(constants.VERIFIER_BOUNTY_PCT).div(100);
      expect(await pool.getVerifierBounty()).to.equal(bounty);
    });

    it('test failure updates pendingFailure, lastVerifiedBlock, verifer, and failedBlock correctly', async () => {
      // test is already failed

      const lastBlock = await blockNumber();
      expect(await pool.pendingFailure()).to.be.true;
      expect(await pool.lastVerifiedBlock()).to.equal(lastBlock);
      expect(await pool.failedBlock()).to.equal(lastBlock);
      expect(await pool.verifier()).to.equal(challenger.address);
    });

    it('test failure updates totalChallengerEligibleBalance correctly', async () => {
      const challengerOneBalance = await pool.getStoredBalance(challenger.address, true);
      const challengerTwoBalance = await pool.getStoredBalance(challenger2.address, true);
      expectAlmostEqual(
        await pool.getTotalChallengerEligibleBalance(),
        challengerOneBalance.add(challengerTwoBalance),
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
    });

    it('users cannot stake/challenge/unstake/withdrawStake/cancelPendingWithdraw on test failure', async () => {
      await expect(pool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT)).to.be.revertedWith(
        'ANTE: Test already failed.'
      );

      await expect(pool.connect(challenger).registerChallenge(constants.ONE_ETH)).to.be.revertedWith(
        'ANTE: Test already failed.'
      );

      await expect(pool.connect(staker2).unstakeAll(false)).to.be.revertedWith('ANTE: Test already failed.');

      await expect(pool.connect(challenger).unstakeAll(true)).to.be.revertedWith('ANTE: Test already failed.');

      await expect(pool.connect(staker2).unstake(constants.ONE_ETH, false)).to.be.revertedWith(
        'ANTE: Test already failed.'
      );

      await expect(pool.connect(challenger).unstake(constants.ONE_ETH, true)).to.be.revertedWith(
        'ANTE: Test already failed.'
      );

      await expect(pool.connect(staker).withdrawStake()).to.be.revertedWith('ANTE: Cannot withdraw');

      await expect(pool.connect(staker).cancelPendingWithdraw()).to.be.revertedWith('ANTE: Test already failed.');
    });

    it('challengers payout on claim calculated correctly for eligible challenger', async () => {
      const expectedPayout = await getExpectedChallengerPayoutWithoutBounty(challenger2, pool);
      expect(await pool.getChallengerPayout(challenger2.address)).to.equal(expectedPayout);
    });

    it('challengers payout on claim calculated correctly for verifier', async () => {
      const expectedPayout = await getExpectedChallengerPayoutWithoutBounty(challenger, pool);
      const bounty = await pool.getVerifierBounty();

      expect(await pool.getChallengerPayout(challenger.address)).to.equal(expectedPayout.add(bounty));
    });

    it('challenger payout calculated correctly for ineligible challenger', async () => {
      // expected payout is just challenger balance for ineligible challenger
      const expectedPayout = await pool.getStoredBalance(challenger3.address, true);

      expect(await pool.getChallengerPayout(challenger3.address)).to.equal(expectedPayout);
    });

    it('transfers correct amount of tokens out of pool on successful claim for all challengers', async () => {
      // check verifier, eligible challenger, and ineligible challenger
      const pool_token_balance = await token.balanceOf(pool.address);
      const challengerOneTokenBalance = await token.balanceOf(challenger.address);
      const challengerTwoTokenBalance = await token.balanceOf(challenger2.address);
      const challengerThreeTokenBalance = await token.balanceOf(challenger3.address);

      // sanity check
      expect(await token.balanceOf(pool.address)).to.be.gt(constants.TWO_ETH);

      // checked that these values are accurate in other tests, so can trust them here
      const challengerOnePayout = await pool.getChallengerPayout(challenger.address);
      const challengerTwoPayout = await pool.getChallengerPayout(challenger2.address);
      const challengerThreePayout = await pool.getChallengerPayout(challenger3.address);

      await pool.connect(challenger).claim();

      expect(await token.balanceOf(pool.address)).to.equal(pool_token_balance.sub(challengerOnePayout));
      expect(await token.balanceOf(challenger.address)).to.equal(challengerOneTokenBalance.add(challengerOnePayout));

      await pool.connect(challenger2).claim();

      expect(await token.balanceOf(pool.address)).to.equal(
        pool_token_balance.sub(challengerOnePayout).sub(challengerTwoPayout)
      );
      expect(await token.balanceOf(challenger2.address)).to.equal(challengerTwoTokenBalance.add(challengerTwoPayout));

      await pool.connect(challenger3).claim();

      expect(await token.balanceOf(pool.address)).to.equal(
        pool_token_balance.sub(challengerOnePayout).sub(challengerTwoPayout).sub(challengerThreePayout)
      );
      expect(await token.balanceOf(challenger3.address)).to.equal(
        challengerThreeTokenBalance.add(challengerThreePayout)
      );

      const expectedAuthorBalance = await pool.getTestAuthorReward();

      expect(await token.balanceOf(pool.address)).to.be.gte(expectedAuthorBalance);
    });

    it('claim updates numPaidOut, totalPaidOut', async () => {
      const payout = await pool.getChallengerPayout(challenger2.address);
      const totalPaidOut = await pool.totalPaidOut();
      const numPaidOut = await pool.numPaidOut();

      await pool.connect(challenger2).claim();

      expect(await pool.totalPaidOut()).to.equal(totalPaidOut.add(payout));
      expect(await pool.numPaidOut()).to.equal(numPaidOut.add(1));
    });

    it('challengers cannot claim multiple times', async () => {
      await pool.connect(challenger).claim();

      await expect(pool.connect(challenger).claim()).to.be.revertedWith('ANTE: No Challenger Staking balance');
    });

    it('address which is not challenging cannot claim', async () => {
      await expect(pool.connect(staker).claim()).to.be.revertedWith('ANTE: No Challenger Staking balance');
    });

    it('cannot claim in a failed pool (by challenger, via factory) where challenger did not have stake', async () => {
      let multiPoolDeployment = await multiPoolSameTest();
      const { token, test, pool0, pool1, pool2 } = multiPoolDeployment;
      const decayPeriod = 20 * constants.ONE_DAY_IN_SECONDS;

      await evmIncreaseTime(decayPeriod);

      await test.setWillFail(true);
      await pool0.connect(challenger).checkTest();

      // All 3 pools associated with the test are failed at this point.
      // This is tested in another test suite.

      const poolBalanceBefore = await token.balanceOf(pool0.address);

      let challenger1Payout = await pool0.getChallengerPayout(challenger.address);
      let challenger2Payout = await pool0.getChallengerPayout(challenger2.address);
      let authorReward = await pool0.getTestAuthorReward();

      await pool0.connect(challenger).claim();
      await pool0.connect(challenger2).claim();
      await pool0.connect(author).claimReward();

      expect(await token.balanceOf(pool0.address)).to.be.equal(
        poolBalanceBefore.sub(challenger1Payout).sub(challenger2Payout).sub(authorReward)
      );

      const pool1BalanceBefore = await token.balanceOf(pool1.address);
      challenger1Payout = await pool1.getChallengerPayout(challenger.address);
      authorReward = await pool1.getTestAuthorReward();

      await pool1.connect(challenger).claim();
      await pool1.connect(author).claimReward();

      expect(await token.balanceOf(pool1.address)).to.be.equal(
        pool1BalanceBefore.sub(challenger1Payout).sub(authorReward)
      );

      await expect(pool2.connect(challenger).claim()).to.be.revertedWith('ANTE: No Challenger Staking balance');
      const stakerBalance = await pool2.getStoredBalance(staker.address, false);
      expectAlmostEqual(await token.balanceOf(pool2.address), stakerBalance, constants.WEI_ROUNDING_ERROR_TOLERANCE);
    });

    it('allows challengers to claim their balance in a failed pool (by challenger, via factory) where challenger is unconfirmed', async () => {
      let multiPoolDeployment = await multiPoolSameTest();
      const { token, test, pool0, pool2 } = multiPoolDeployment;
      const decayPeriod = 20 * constants.ONE_DAY_IN_SECONDS;

      await pool2.connect(challenger3).registerChallenge(constants.ONE_ETH.div(10));

      await evmIncreaseTime(decayPeriod);

      await test.setWillFail(true);
      await pool0.connect(challenger).checkTest();

      const balanceBefore = await token.balanceOf(challenger3.address);
      const storedBalance = await pool2.getStoredBalance(challenger3.address, true);

      await pool2.connect(challenger3).claim();

      expect(await token.balanceOf(challenger3.address)).to.be.eq(balanceBefore.add(storedBalance));
    });
  });

  describe('claimReward', () => {
    it("should transfer ERC20 reward into test author's wallet", async () => {
      const initAuthorTokenBalance = await token.balanceOf(author.address);
      const initPoolTokenBalance = await token.balanceOf(pool.address);
      const expectedAuthorBalance = await pool.getTestAuthorReward();

      await pool.connect(author).claimReward();

      expect(await token.balanceOf(author.address)).to.be.equal(initAuthorTokenBalance.add(expectedAuthorBalance));
      expect(await token.balanceOf(pool.address)).to.be.equal(initPoolTokenBalance.sub(expectedAuthorBalance));
    });

    it('revert if not the author', async () => {
      await expect(pool.connect(staker).claimReward()).to.be.revertedWith('ANTE: Only author can claim');
    });

    it('should emit RewardPaid event on successful withdraw with correct args', async () => {
      const expected = await pool.getTestAuthorReward();
      await expect(pool.connect(author).claimReward()).to.emit(pool, 'RewardPaid').withArgs(author.address, expected);
    });
  });
});
