import { oneSupportChallengeFixture } from '../fixtures/oneSupportChallenge.fixture';
import {
  evmSnapshot,
  evmRevert,
  calculateGasUsed,
  getExpectedFutureStakerBalance,
  getExpectedFutureChallengerBalance,
  expectAlmostEqual,
  blockTimestamp,
  evmIncreaseTime,
  deployTestAndPool,
  evmSetNextBlockTimestamp,
  evmMineBlocks,
  calculateDecay,
  givePoolAllowance,
  getExpectedCurrentStakerBalance,
  getExpectedCurrentChallengerBalance,
} from '../helpers';

import * as constants from '../constants';

import hre from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider } = waffle;

import { expect } from 'chai';
import { AnteERC20, AnteConditionalTest__factory, AnteConditionalTest, IAntePool } from '../../typechain';
import { BasicFixture } from '../fixtures/basic.fixture';

describe('Unstake and UnstakeAll', function () {
  const wallets = provider.getWallets();
  const [deployer, _, staker, challenger, staker_2, challenger_2] = wallets;

  let deployment: BasicFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let pool: IAntePool;
  let token: AnteERC20;
  let failingPool: IAntePool;

  before(async () => {
    deployment = await loadFixture(oneSupportChallengeFixture);
    globalSnapshotId = await evmSnapshot();
    snapshotId = await evmSnapshot();

    pool = deployment.oddBlockDeployment.pool;
    token = deployment.token;
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
  });

  describe('unstakeAll', () => {
    it('cannot unstake before timelock', async () => {
      const unlockTime = await pool.getUnstakeAllowedTime(staker.address);
      const now = await blockTimestamp();
      expect(now).to.be.lt(unlockTime);
      await expect(pool.connect(staker).unstakeAll(false)).to.be.revertedWith(
        'ANTE: Staker cannot unstake before commited time'
      );
    });

    it('can unstake after timelock', async () => {
      const unlockTime = Number(await pool.getUnstakeAllowedTime(staker.address));
      let now = await blockTimestamp();
      await evmSetNextBlockTimestamp(unlockTime + 1);
      await evmMineBlocks(1);
      now = await blockTimestamp();
      expect(now).to.be.gt(unlockTime);
      await pool.connect(staker).unstakeAll(false);
      expect(await pool.getTotalStaked()).to.equal(0);
    });

    it('updates getTotalStaked, numUsers, and getTotalPendingWithdraw properly', async () => {
      await pool.connect(staker_2).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
      const stake2Time = await blockTimestamp();
      const unstakeAllowedTime = (await pool.getUnstakeAllowedTime(staker.address)).toNumber();
      const timeUntilUnstake = unstakeAllowedTime - stake2Time;
      const expectedSupporterTwoBalance = await getExpectedFutureStakerBalance(staker_2, pool, timeUntilUnstake);
      const expectedSupporterOneBalance = await getExpectedFutureStakerBalance(staker, pool, timeUntilUnstake);
      const stakingInfo = await pool.stakingInfo();

      await evmSetNextBlockTimestamp(unstakeAllowedTime);
      await pool.connect(staker).unstakeAll(false);

      expect((await pool.stakingInfo()).numUsers).to.equal(stakingInfo.numUsers.sub(1));
      expect(await pool.getTotalPendingWithdraw()).to.equal(expectedSupporterOneBalance);
      expectAlmostEqual(
        await pool.getTotalStaked(),
        expectedSupporterTwoBalance,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
    });

    it('should update user stored balance, pendingWithdrawAmount, and pendingWithdrawAllowedTime correctly on unstakeAll', async () => {
      const staker_balance = await pool.getStoredBalance(staker.address, false);
      const startTime = await blockTimestamp();
      const challengerStake = await pool.getTotalChallengerStaked();

      const unstakeAllowedTime = (await pool.getUnstakeAllowedTime(staker.address)).toNumber();

      // Calculate delay accrued since start of this test up until unstake
      const { stakerDecayShare } = calculateDecay(challengerStake, unstakeAllowedTime - startTime);
      await evmSetNextBlockTimestamp(unstakeAllowedTime);
      await pool.connect(staker).unstakeAll(false);

      const timestamp = await blockTimestamp();

      // make sure user balances are correct
      expect(await pool.getStoredBalance(staker.address, false)).to.be.equal(0);
      expect(await pool.getStoredBalance(staker.address, true)).to.be.equal(0);

      expect(await pool.getPendingWithdrawAmount(staker.address)).to.be.equal(staker_balance.add(stakerDecayShare));

      expect(await pool.getPendingWithdrawAllowedTime(staker.address)).to.equal(
        timestamp + constants.ONE_DAY_IN_SECONDS
      );
    });

    it('should update user stored balance correctly on unstake challenge', async () => {
      await pool.connect(challenger).unstakeAll(true);
      // make sure user balances are correct
      expect(await pool.getStoredBalance(challenger.address, true)).to.be.equal(0);
      expect(await pool.getStoredBalance(challenger.address, false)).to.be.equal(0);
    });

    it('should update user stored balance correctly on unstakeAll challenge', async () => {
      await pool.connect(challenger).unstakeAll(true);
      // make sure user balances are correct
      expect(await pool.getStoredBalance(challenger.address, true)).to.be.equal(0);
      expect(await pool.getStoredBalance(challenger.address, false)).to.be.equal(0);
    });

    it('cannot leave a challenger balance less than minimum challenger stake', async () => {
      const balance = await pool.getStoredBalance(challenger.address, true);
      // try to unstake whole balance except 1000 wei (minus one block decay);
      await expect(pool.connect(challenger).unstake(balance.sub(1000), true)).to.be.reverted;
    });

    it('cannot unstakeAll the same stake twice', async () => {
      const unlockTime = Number(await pool.getUnstakeAllowedTime(staker.address));
      await evmSetNextBlockTimestamp(unlockTime);
      await pool.connect(staker).unstakeAll(false);
      await expect(pool.connect(staker).unstakeAll(false)).to.be.reverted;

      await pool.connect(challenger).unstakeAll(true);
      await expect(pool.connect(challenger).unstakeAll(true)).to.be.reverted;
    });

    it('updates getTotalChallengerStaked, getTotalPendingWithdraw, and numUsers properly on unstakeAll challenger', async () => {
      await pool.connect(challenger_2).registerChallenge(constants.ONE_ETH.div(50));
      const registerTime = await blockTimestamp();
      const confirmTime = registerTime + constants.CHALLENGER_TIMESTAMP_DELAY;
      await evmSetNextBlockTimestamp(confirmTime);
      await pool.connect(challenger_2).confirmChallenge();

      const someDelay = 10;
      const unstakeTime = confirmTime + someDelay;

      // Extra decay between confirm and unstakeAll calls
      const expectedChallengerTwoBalance = await getExpectedFutureChallengerBalance(challenger_2, pool, someDelay);

      await evmSetNextBlockTimestamp(unstakeTime);
      await pool.connect(challenger).unstakeAll(true);
      expectAlmostEqual(
        await pool.getTotalChallengerStaked(),
        expectedChallengerTwoBalance,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
    });

    it('should not transfer tokens out of pool on unstakeAll', async () => {
      const staker_wallet_balance = await staker.getBalance();
      const staker_wallet_token_balance = await token.balanceOf(staker.address);
      const pool_balance = await provider.getBalance(pool.address);
      const pool_token_balance = await token.balanceOf(pool.address);

      const unstakeAllowedTime = (await pool.getUnstakeAllowedTime(staker.address)).toNumber();

      await evmSetNextBlockTimestamp(unstakeAllowedTime);
      const txpromise = await pool.connect(staker).unstakeAll(false);
      const gasCost = await calculateGasUsed(txpromise);

      expect(await staker.getBalance()).to.equal(staker_wallet_balance.sub(gasCost));
      expect(await token.balanceOf(staker.address)).to.equal(staker_wallet_token_balance);

      expect(await provider.getBalance(pool.address)).to.equal(pool_balance);
      expect(await token.balanceOf(pool.address)).to.equal(pool_token_balance);
    });

    it('should transfer tokens on unstakeAll challenge', async () => {
      const startTime = await blockTimestamp();
      const challenger_balance = await pool.getStoredBalance(challenger.address, true);
      const challenger_wallet_balance = await challenger.getBalance();
      const challenger_wallet_token_balance = await token.balanceOf(challenger.address);
      const pool_balance = await provider.getBalance(pool.address);
      const pool_token_balance = await token.balanceOf(pool.address);
      const someDelay = 10;
      const { totalDecay } = calculateDecay(challenger_balance, someDelay);
      const expected_unstake_amount = challenger_balance.sub(totalDecay);
      await evmSetNextBlockTimestamp(startTime + someDelay);
      const txpromise = await pool.connect(challenger).unstakeAll(true);
      const gasCost = await calculateGasUsed(txpromise);

      expect(await challenger.getBalance()).to.equal(challenger_wallet_balance.sub(gasCost));

      expectAlmostEqual(
        await token.balanceOf(challenger.address),
        challenger_wallet_token_balance.add(expected_unstake_amount),
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );

      expectAlmostEqual(await provider.getBalance(pool.address), pool_balance, constants.WEI_ROUNDING_ERROR_TOLERANCE);

      expectAlmostEqual(
        await token.balanceOf(pool.address),
        pool_token_balance.sub(expected_unstake_amount),
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
    });

    it('leads to challenger totalAmount > 0 and numUsers = 0 after subsequent challenger stakes', async () => {
      // Ensure there is enough stake
      await pool.connect(staker).stake(constants.ONE_ETH.mul(20), constants.MIN_STAKE_COMMITMENT * 10);
      expect(await pool.getStoredBalance(challenger.address, true)).to.be.gt(0);

      await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(20));
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await pool.connect(challenger).confirmChallenge();

      await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS);

      await pool.connect(challenger_2).registerChallenge(constants.ONE_ETH.div(14));
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await pool.connect(challenger_2).confirmChallenge();

      await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS);

      await pool.connect(challenger_2).registerChallenge(constants.ONE_ETH.div(11));
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await pool.connect(challenger_2).confirmChallenge();

      await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS);

      await pool.connect(challenger).unstakeAll(true);
      await pool.connect(challenger_2).unstakeAll(true);

      expect((await pool.challengerInfo()).totalAmount).to.be.gt(0);
      expect((await pool.challengerInfo()).numUsers).to.be.equal(0);
    });

    describe('failing pool', () => {
      beforeEach(async () => {
        const conditionalFactory = (await hre.ethers.getContractFactory(
          'AnteConditionalTest',
          staker
        )) as AnteConditionalTest__factory;

        const conditionalTestDeployment = await deployTestAndPool<AnteConditionalTest>(
          staker,
          deployment.poolFactory,
          conditionalFactory,
          [],
          {
            tokenAddress: token.address,
          }
        );

        await conditionalTestDeployment.test.setWillFail(true);
        failingPool = conditionalTestDeployment.pool;

        await givePoolAllowance(failingPool, token, [staker, challenger]);

        await failingPool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
        await failingPool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
        await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
        await failingPool.connect(challenger).confirmChallenge();

        // Generate some decay
        await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS);
      });

      it('reverts if staker tries to unstakes all and there are challengers', async () => {
        await evmMineBlocks(12);
        // Fail the test
        await failingPool.connect(challenger).checkTest();

        expect(await failingPool.pendingFailure()).to.be.true;
        await expect(failingPool.connect(staker).unstakeAll(false)).to.be.revertedWith('ANTE: Test already failed.');
      });

      it('can unstake all if user is staker and there are no challengers', async () => {
        const initialStakerTokenBalance = await token.balanceOf(staker.address);
        await failingPool.connect(challenger).unstakeAll(true);
        await evmIncreaseTime(constants.MIN_STAKE_COMMITMENT);
        const balance = await failingPool.getStoredBalance(staker.address, false);

        await failingPool.connect(staker).unstakeAll(false);
        const unstakeTime = await blockTimestamp();
        expect(await failingPool.getStoredBalance(staker.address, false)).to.be.equal(0);
        await evmSetNextBlockTimestamp(unstakeTime + constants.ONE_DAY_IN_SECONDS * 2);

        await failingPool.connect(staker).withdrawStake();
        const finalStakerTokenBalance = await token.balanceOf(staker.address);

        expect(finalStakerTokenBalance.sub(initialStakerTokenBalance)).to.be.equal(balance);
      });

      it('reverts if challenger tries to unstake all', async () => {
        await evmMineBlocks(12);
        // Fail the test
        await failingPool.connect(challenger).checkTest();

        expect(await failingPool.pendingFailure()).to.be.true;
        await expect(failingPool.connect(challenger).unstakeAll(true)).to.be.revertedWith('ANTE: Test already failed.');
      });
    });
  });

  describe('unstake', () => {
    it('updates getTotalStaked, numusers, and getTotalPendingWithdraw properly', async () => {
      const stakingInfo = await pool.stakingInfo();
      const expectedStakerBalance = await getExpectedCurrentStakerBalance(staker, pool);
      expectAlmostEqual(await pool.getTotalStaked(), expectedStakerBalance, constants.WEI_ROUNDING_ERROR_TOLERANCE);

      const someDelay = 10;
      const expectedFutureStakerBalance = await getExpectedFutureStakerBalance(staker, pool, someDelay);
      const startTime = await blockTimestamp();
      // some decay accrues
      await evmSetNextBlockTimestamp(startTime + someDelay);
      await pool.connect(challenger).unstakeAll(true);

      expect((await pool.stakingInfo()).numUsers).to.equal(stakingInfo.numUsers);
      expectAlmostEqual(
        await pool.getTotalStaked(),
        expectedFutureStakerBalance,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );

      const unstakeTime = await pool.getUnstakeAllowedTime(staker.address);
      await evmSetNextBlockTimestamp(unstakeTime.toNumber());
      await pool.connect(staker).unstake(constants.HALF_ETH, false);

      expectAlmostEqual(
        await pool.getTotalStaked(),
        expectedFutureStakerBalance.sub(constants.HALF_ETH),
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );

      expect(await pool.getTotalPendingWithdraw()).to.equal(constants.HALF_ETH);

      await pool.connect(staker).unstake(constants.ONE_ETH.div(4), false);

      expectAlmostEqual(
        await pool.getTotalStaked(),
        expectedFutureStakerBalance.sub(constants.ONE_ETH.mul(3).div(4)),
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
      expect(await pool.getTotalPendingWithdraw()).to.equal(constants.HALF_ETH.add(constants.ONE_ETH.div(4)));

      // didn't unstake entire staker balance
      expect((await pool.stakingInfo()).numUsers).to.equal(stakingInfo.numUsers);
    });

    it('updates getTotalChallengerStaked and numUsers properly on unstake challenge', async () => {
      const startTime = await blockTimestamp();
      let expectedCurrentChallengerBalance = await getExpectedCurrentChallengerBalance(challenger, pool);

      expectAlmostEqual(
        await pool.getTotalChallengerStaked(),
        expectedCurrentChallengerBalance,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
      const challengerInfo = await pool.challengerInfo();

      const unstakeTime = (await pool.getUnstakeAllowedTime(staker.address)).toNumber();
      await evmSetNextBlockTimestamp(unstakeTime);

      await pool.connect(staker).unstakeAll(false);
      const { totalDecay } = calculateDecay(expectedCurrentChallengerBalance, unstakeTime - startTime);

      // No more decay after staker unstakes all

      expectedCurrentChallengerBalance = expectedCurrentChallengerBalance.sub(totalDecay);

      expectAlmostEqual(
        await pool.getTotalChallengerStaked(),
        expectedCurrentChallengerBalance,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );

      const someDelay = 200;
      const unstakeTimeChallenger = unstakeTime + someDelay;
      await evmSetNextBlockTimestamp(unstakeTimeChallenger);
      const unstakeAmount1 = constants.ONE_ETH.div(600);
      await pool.connect(challenger).unstake(unstakeAmount1, true);

      expectedCurrentChallengerBalance = expectedCurrentChallengerBalance.sub(unstakeAmount1);

      expectAlmostEqual(
        await pool.getTotalChallengerStaked(),
        expectedCurrentChallengerBalance,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );

      const unstakeAmount2 = constants.ONE_ETH.div(800);

      const unstakeTime2Challenger = unstakeTimeChallenger + someDelay;
      await evmSetNextBlockTimestamp(unstakeTime2Challenger);

      await pool.connect(challenger).unstake(unstakeAmount2, true);

      expectedCurrentChallengerBalance = expectedCurrentChallengerBalance.sub(unstakeAmount2);
      expectAlmostEqual(
        await pool.getTotalChallengerStaked(),
        expectedCurrentChallengerBalance,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );

      // didnt unstake full challengers balance
      expect((await pool.challengerInfo()).numUsers).to.equal(challengerInfo.numUsers);
    });

    it('should update user stored balance, pendingWithdrawAmount, and pendingWithdrawAllowedTime correctly on unstake', async () => {
      const staker_balance = await pool.getStoredBalance(staker.address, false);
      const startTime = await blockTimestamp();
      const unstakeTime = (await pool.getUnstakeAllowedTime(staker.address)).toNumber();
      const expectedStakerBalance = await getExpectedFutureStakerBalance(staker, pool, unstakeTime - startTime);
      await evmSetNextBlockTimestamp(unstakeTime);
      await pool.connect(staker).unstake(constants.HALF_ETH, false);

      // make sure user balances are correct
      expectAlmostEqual(
        await pool.getStoredBalance(staker.address, false),
        expectedStakerBalance.sub(constants.HALF_ETH),
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
      expect(await pool.getStoredBalance(staker.address, true)).to.be.equal(0);

      expect(await pool.getPendingWithdrawAmount(staker.address)).to.be.equal(constants.HALF_ETH);

      expect(await pool.getPendingWithdrawAllowedTime(staker.address)).to.equal(
        unstakeTime + constants.ONE_DAY_IN_SECONDS
      );
    });

    it("can unstake less then unconfirmed shares. Doesn't subtract shares from totalShares", async () => {
      // Increase challenger stake threshold
      await pool.connect(staker_2).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);

      // Confirmed 0.06 ETH
      // Unconfirmed 0.04 ETH
      // Unstake 0.02 ETH
      expect(await pool.getStoredBalance(challenger_2.address, true)).to.be.equal(0);
      await pool.connect(challenger_2).registerChallenge(constants.ONE_ETH.div(100).mul(6));
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await pool.connect(challenger_2).confirmChallenge();
      await pool.connect(challenger_2).registerChallenge(constants.ONE_ETH.div(100).mul(4));

      const totalShares = await pool.eligibilityInfo();

      const { totalDecay } = calculateDecay(totalShares, 1);
      // Ensure next block takes 1 second
      await evmSetNextBlockTimestamp((await blockTimestamp()) + 1);
      await pool.connect(challenger_2).unstake(constants.ONE_ETH.div(100).mul(2), true);

      expectAlmostEqual(
        await pool.eligibilityInfo(),
        totalShares.sub(totalDecay),
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
    });

    it('user cannot unstake more than they have staked', async () => {
      await expect(pool.connect(staker).unstake(constants.ONE_ETH.mul(101).div(100), false)).to.be.reverted;
      await expect(pool.connect(challenger).unstake(constants.ONE_ETH.mul(101).div(100), true)).to.be.reverted;
    });

    it('should not transfer tokens when initiating withdraw of staker position', async () => {
      const staker_token_balance = await token.balanceOf(staker.address);
      const pool_balance = await provider.getBalance(pool.address);
      const pool_token_balance = await token.balanceOf(pool.address);

      const unstakeTime = (await pool.getUnstakeAllowedTime(staker.address)).toNumber();

      await evmSetNextBlockTimestamp(unstakeTime);

      await pool.connect(staker).unstake(constants.HALF_ETH, false);

      expect(await token.balanceOf(staker.address)).to.equal(staker_token_balance);
      expect(await provider.getBalance(pool.address)).to.equal(pool_balance);
      expect(await token.balanceOf(pool.address)).to.equal(pool_token_balance);
    });

    it('should transfer tokens when withdrawing challenger position', async () => {
      const challenger_balance = await challenger.getBalance();
      const challenger_token_balance = await token.balanceOf(challenger.address);
      const challengedAmount = await pool.connect(challenger).getStoredBalance(challenger.address, true);
      const unstakeAmount = challengedAmount.sub(constants.MIN_CHALLENGER_STAKE).div(2);

      const txpromise = await pool.connect(challenger).unstake(unstakeAmount, true);
      const gasCost = await calculateGasUsed(txpromise);

      expect(await challenger.getBalance()).to.equal(challenger_balance.sub(gasCost));
      expect(await token.balanceOf(challenger.address)).to.equal(challenger_token_balance.add(unstakeAmount));
    });

    it('should emit unstake event on unstake with proper args', async () => {
      const unstakeTime = (await pool.getUnstakeAllowedTime(staker.address)).toNumber();
      await evmSetNextBlockTimestamp(unstakeTime);

      await expect(pool.connect(staker).unstake(constants.HALF_ETH, false))
        .to.emit(pool, 'Unstake')
        .withArgs(staker.address, constants.HALF_ETH, false);
    });

    it('should emit unstake event on unstake challenge with proper args', async () => {
      await expect(pool.connect(challenger).unstake(constants.HALF_ETH.div(100), true))
        .to.emit(pool, 'Unstake')
        .withArgs(challenger.address, constants.HALF_ETH.div(100), true);
    });

    it('reverts if challenger unstakes down to between 0 and minChallengerStake', async () => {
      const balance = await pool.getStoredBalance(challenger.address, true);
      const minChallengerStake = await pool.minChallengerStake();

      await expect(pool.connect(challenger).unstake(balance.sub(minChallengerStake).add(1), true)).to.be.revertedWith(
        'ANTE: balance must be zero or greater than min'
      );
    });

    it('reverts if staker unstakes down to between 0 and minSupporterStake', async () => {
      const unstakeTime = (await pool.getUnstakeAllowedTime(staker.address)).toNumber();
      await evmSetNextBlockTimestamp(unstakeTime);

      const balance = await pool.getStoredBalance(staker.address, false);
      const minSupporterStake = await pool.minSupporterStake();

      await expect(pool.connect(staker).unstake(balance.sub(minSupporterStake.div(2)), false)).to.be.revertedWith(
        'ANTE: balance must be zero or greater than min'
      );
    });

    describe('failing pool', () => {
      beforeEach(async () => {
        const conditionalFactory = (await hre.ethers.getContractFactory(
          'AnteConditionalTest',
          deployer
        )) as AnteConditionalTest__factory;

        const conditionalTestDeployment = await deployTestAndPool<AnteConditionalTest>(
          deployer,
          deployment.poolFactory,
          conditionalFactory,
          [],
          {
            tokenAddress: token.address,
          }
        );

        await conditionalTestDeployment.test.setWillFail(true);
        failingPool = conditionalTestDeployment.pool;

        await givePoolAllowance(failingPool, token, [staker, challenger]);

        await failingPool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
        await failingPool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
        await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
        await failingPool.connect(challenger).confirmChallenge();

        await evmMineBlocks(12);
        // Fail the test
        await failingPool.connect(challenger).checkTest();

        expect(await failingPool.pendingFailure()).to.be.true;
      });

      it('reverts if staker tries to unstake after checkTest has failed the underlying test and challengers have stake', async () => {
        await expect(failingPool.connect(staker).unstake(constants.ONE_ETH.div(10), false)).to.be.revertedWith(
          'ANTE: Test already failed.'
        );
      });

      it('reverts if challenger tries to unstake after checkTest has failed the underlying test and challenger has stake', async () => {
        await expect(failingPool.connect(challenger).unstake(constants.ONE_ETH.div(10), true)).to.be.revertedWith(
          'ANTE: Test already failed.'
        );
      });
    });
  });
});
