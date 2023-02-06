import * as constants from '../constants';
import hre from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider } = waffle;
import { withdrawableStakeFixture } from '../fixtures/withdrawableStake.fixture';
import { BasicFixture } from '../fixtures/basic.fixture';
import {
  evmSnapshot,
  evmRevert,
  calculateGasUsed,
  getExpectedFutureStakerBalance,
  expectAlmostEqual,
  blockTimestamp,
  evmIncreaseTime,
  deployTestAndPool,
  evmSetNextBlockTimestamp,
  getExpectedCurrentStakerBalance,
  givePoolAllowance,
  evmMineBlocks,
  deployPool,
} from '../helpers';
import { expect } from 'chai';
import { AnteERC20, AnteConditionalTest__factory, IAntePool } from '../../typechain';

describe('Withdraw Stake and Cancel Withdraw', () => {
  const wallets = provider.getWallets();
  const [deployer, _author, staker, challenger, staker_2] = wallets;

  let deployment: BasicFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let pool: IAntePool;
  let token: AnteERC20;

  before(async () => {
    deployment = await loadFixture(withdrawableStakeFixture);
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

  describe('withdrawStake', () => {
    it('updates getTotalPendingWithdraw correctly and leaves getTotalStaked unchanged', async () => {
      expect(await pool.getTotalPendingWithdraw()).to.equal(constants.HALF_ETH);
      const total_staked = await pool.getTotalStaked();

      await pool.connect(staker).withdrawStake();

      expect(await pool.getTotalPendingWithdraw()).to.equal(0);
      expect(await pool.getTotalStaked()).to.equal(total_staked);
    });

    it('updates user pendingWithdrawAmount and leaves getStoredBalance unchanged', async () => {
      expect(await pool.getPendingWithdrawAmount(staker.address)).to.equal(constants.HALF_ETH);

      const start = await blockTimestamp();
      const withdrawTime = start + constants.ONE_DAY_IN_SECONDS + 1;
      await evmSetNextBlockTimestamp(withdrawTime);
      await pool.connect(staker).withdrawStake();

      expect(await pool.getPendingWithdrawAmount(staker.address)).to.equal(0);

      expectAlmostEqual(
        await pool.getStoredBalance(staker.address, false),
        await getExpectedCurrentStakerBalance(staker, pool),
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
    });

    it('should not allow user to withdrawStake before withdraw window has passed', async () => {
      await pool.connect(staker_2).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
      const unstakeTime = await pool.getUnstakeAllowedTime(staker_2.address);
      await evmSetNextBlockTimestamp(unstakeTime.toNumber());
      await pool.connect(staker_2).unstakeAll(false);

      await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS * 0.99);

      await expect(pool.connect(staker_2).withdrawStake()).to.be.revertedWith(
        'ANTE: must wait 24 hours to withdraw stake'
      );
    });

    it('should not allow user to withdraw the same stake multiple times', async () => {
      await pool.connect(staker).withdrawStake();

      await expect(pool.connect(staker).withdrawStake()).to.be.reverted;
    });

    it('should withdraw tokens to wallet on successful withdrawStake call', async () => {
      const staker_wallet_balance = await staker.getBalance();
      const staker_wallet_token_balance = await token.balanceOf(staker.address);
      const pool_balance = await provider.getBalance(pool.address);
      const pool_token_balance = await token.balanceOf(pool.address);

      const txpromise = await pool.connect(staker).withdrawStake();
      const gasCost = await calculateGasUsed(txpromise);

      expect(await staker.getBalance()).to.equal(staker_wallet_balance.sub(gasCost));
      expect(await token.balanceOf(staker.address)).to.equal(staker_wallet_token_balance.add(constants.HALF_ETH));
      expect(await provider.getBalance(pool.address)).to.equal(pool_balance);
      expect(await token.balanceOf(pool.address)).to.equal(pool_token_balance.sub(constants.HALF_ETH));
    });

    it('should emit WithdrawStake event on successful withdraw with correct args', async () => {
      await expect(pool.connect(staker).withdrawStake())
        .to.emit(pool, 'WithdrawStake')
        .withArgs(staker.address, constants.HALF_ETH);
    });

    describe('failing pool', () => {
      let failingPool: IAntePool;
      let failingPool2: IAntePool;

      beforeEach(async () => {
        const conditionalFactory = (await hre.ethers.getContractFactory(
          'AnteConditionalTest',
          deployer
        )) as AnteConditionalTest__factory;

        const conditionalTestDeployment = await deployTestAndPool(
          deployer,
          deployment.poolFactory,
          conditionalFactory,
          [],
          {
            tokenAddress: token.address,
          }
        );

        failingPool = conditionalTestDeployment.pool;
        await givePoolAllowance(failingPool, token, [staker, challenger]);
        failingPool2 = await deployPool(deployment.poolFactory, conditionalTestDeployment.test.address, {
          tokenAddress: token.address,
          payoutRatio: 11, // Unique parameters need for unique pool hash
        });
        await conditionalTestDeployment.test.setWillFail(true);
        await givePoolAllowance(failingPool2, token, [staker, challenger]);
        await failingPool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
        await failingPool2.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
        await failingPool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
        await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
        await failingPool.connect(challenger).confirmChallenge();

        // Generate some decay
        await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS);
      });

      it('reverts if staker withdraw from a failed pool and there are challengers', async () => {
        await evmMineBlocks(12);
        // Fail the test
        await failingPool.connect(challenger).checkTest();

        expect(await failingPool.pendingFailure()).to.be.true;

        await expect(failingPool.connect(staker).withdrawStake()).to.be.revertedWith('ANTE: Cannot withdraw');
      });

      it('can withdraw stake if pool has failed and there are no challengers', async () => {
        // Remove all challenger stake
        await evmMineBlocks(12);
        await failingPool.connect(challenger).checkTest();

        expect(await failingPool2.pendingFailure()).to.be.true;
        expect(await failingPool2.getTotalChallengerStaked()).to.be.equal(0);

        const expectedBalance = await getExpectedCurrentStakerBalance(staker, failingPool2);
        await failingPool2.connect(staker).unstakeAll(false);
        await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS + 1);

        expect(await failingPool2.getPendingWithdrawAmount(staker.address)).to.equal(expectedBalance);
        await failingPool2.connect(staker).withdrawStake();
        expect(await failingPool2.getPendingWithdrawAmount(staker.address)).to.equal(0);
      });
    });
  });

  describe('getPendingWithdrawAllowedTime', () => {
    it('should reset the withdraw timer on subsequent unstake calls', async () => {
      await pool.connect(staker).unstake(constants.ONE_ETH.div(10), false);

      const timestamp = await blockTimestamp();
      expect(await pool.getPendingWithdrawAllowedTime(staker.address)).to.equal(
        timestamp + constants.ONE_DAY_IN_SECONDS
      );
    });
  });

  describe('cancelPendingWithdraw', () => {
    it('does not transfer tokens out of pool', async () => {
      const pool_balance = await provider.getBalance(pool.address);
      const pool_token_balance = await token.balanceOf(pool.address);

      await pool.connect(staker).cancelPendingWithdraw();

      expect(await provider.getBalance(pool.address)).to.equal(pool_balance);
      expect(await token.balanceOf(pool.address)).to.equal(pool_token_balance);
    });

    it('updates getTotalStaked, getTotalPendingWithdraw, and numUsers correctly', async () => {
      const stakingInfo = await pool.stakingInfo();
      expect(await pool.getTotalPendingWithdraw()).to.equal(constants.HALF_ETH);
      const cancelTime = (await blockTimestamp()) + 1;
      const expectedSupporterBalance = await getExpectedFutureStakerBalance(staker, pool, 1);
      await evmSetNextBlockTimestamp(cancelTime);
      await pool.connect(staker).cancelPendingWithdraw();

      // didn't unstake full amount
      expect((await pool.stakingInfo()).numUsers).to.equal(stakingInfo.numUsers);
      expectAlmostEqual(
        await pool.getTotalStaked(),
        expectedSupporterBalance.add(constants.HALF_ETH),
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
      expect(await pool.getTotalPendingWithdraw()).to.equal(0);

      // stake and unstake a second user to make sure numUsers updates
      await pool.connect(staker_2).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
      expect((await pool.stakingInfo()).numUsers).to.equal(stakingInfo.numUsers.add(1));
      const stake2Time = await blockTimestamp();
      await evmSetNextBlockTimestamp(stake2Time + constants.MIN_STAKE_COMMITMENT);
      await pool.connect(staker_2).unstakeAll(false);
      expect((await pool.stakingInfo()).numUsers).to.equal(stakingInfo.numUsers);
      await pool.connect(staker_2).cancelPendingWithdraw();
      expect((await pool.stakingInfo()).numUsers).to.equal(stakingInfo.numUsers.add(1));
    });

    it('updates user balance and pendingWithdraw amount correctly', async () => {
      expect(await pool.getPendingWithdrawAmount(staker.address)).to.equal(constants.HALF_ETH);
      const expectedSupporterBalance = await getExpectedFutureStakerBalance(staker, pool, 1);
      const cancelTime = (await blockTimestamp()) + 1;
      await evmSetNextBlockTimestamp(cancelTime);
      await pool.connect(staker).cancelPendingWithdraw();

      expectAlmostEqual(
        await pool.getStoredBalance(staker.address, false),
        expectedSupporterBalance.add(constants.HALF_ETH),
        2
      );
      expect(await pool.getPendingWithdrawAmount(staker.address)).to.equal(0);
    });

    it('cannot withdrawStake after cancel pending withdraw', async () => {
      await pool.connect(staker).cancelPendingWithdraw();

      await expect(pool.connect(staker).cancelPendingWithdraw()).to.be.revertedWith(
        'ANTE: No pending withdraw balance'
      );
    });

    it('reverts for wallet with no withdrawable stake', async () => {
      await expect(pool.connect(staker_2).cancelPendingWithdraw()).to.be.revertedWith(
        'ANTE: No pending withdraw balance'
      );
    });

    it('emits CancelWithdraw event with correct args', async () => {
      await expect(pool.connect(staker).cancelPendingWithdraw())
        .to.emit(pool, 'CancelWithdraw')
        .withArgs(staker.address, constants.HALF_ETH);
    });
  });

  describe('unstakeAll', () => {
    it('resets 24 hour withdrawal timer after cancelPendingWithdraw', async () => {
      await pool.connect(staker).cancelPendingWithdraw();
      await pool.connect(staker).unstakeAll(false);
      const timestamp = await blockTimestamp();
      expect(await pool.getPendingWithdrawAllowedTime(staker.address)).to.equal(
        timestamp + constants.ONE_DAY_IN_SECONDS
      );
    });
  });
});
