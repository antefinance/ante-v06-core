import { basicFixture, BasicFixture } from '../fixtures/basic.fixture';
import {
  evmSnapshot,
  evmRevert,
  calculateGasUsed,
  blockNumber,
  blockTimestamp,
  evmIncreaseTime,
  evmSetNextBlockTimestamp,
  calculateDecay,
  expectAlmostEqual,
} from '../helpers';

import { ethers } from 'ethers';

import * as constants from '../constants';

import hre from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider } = waffle;

import { expect } from 'chai';
import { AnteERC20, IAntePool } from '../../typechain';

describe('Timelocked Stake Support', function () {
  const wallets = provider.getWallets();
  const [_1, _2, staker, challenger, staker_2, challenger_2, unallowedStaker] = wallets;

  let deployment: BasicFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let localSnapshotId: string;
  let pool: IAntePool;
  let token: AnteERC20;

  before(async () => {
    deployment = await loadFixture(basicFixture);
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

  describe('stake()', () => {
    it('does not allow staking with a time commitment below 24 hours', async () => {
      await expect(
        pool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT / 2)
      ).to.be.revertedWith('ANTE: Cannot commit stake for less than 24 hours');
    });

    it('does not allow staking with a time commitment over 2 years', async () => {
      await expect(
        pool.connect(staker).stake(constants.ONE_ETH, constants.MAX_STAKE_COMMITMENT + 1)
      ).to.be.revertedWith('ANTE: Cannot commit stake for more than 730 days');
    });

    it('allows staking with a time commitment of at least 24 hours', async () => {
      await pool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
      expect(await pool.getTotalStaked()).to.equal(constants.ONE_ETH);
    });

    it('properly updates unlockTimestamp', async () => {
      const timelock = constants.ONE_DAY_IN_SECONDS;
      await pool.connect(staker).stake(constants.ONE_ETH, timelock);
      const expected = (await blockTimestamp()) + timelock;
      expect(await pool.getUnstakeAllowedTime(staker.address)).to.equal(expected);
    });

    it('does not set unlockTimestamp to less then the previous unlockTimestamp', async () => {
      const timelock = constants.ONE_DAY_IN_SECONDS;
      await pool.connect(staker).stake(constants.ONE_ETH, timelock);
      const expected = (await blockTimestamp()) + timelock;
      expect(await pool.getUnstakeAllowedTime(staker.address)).to.equal(expected);

      // Extend their lock on initial stake
      const timelock1 = constants.ONE_DAY_IN_SECONDS * 30;
      await pool.connect(staker).extendStakeLock(timelock1);
      const expected1 = expected + timelock1;
      expect(await pool.getUnstakeAllowedTime(staker.address)).to.equal(expected1);

      // Add additional stake
      await expect(pool.connect(staker).stake(constants.ONE_ETH, timelock)).to.be.revertedWith(
        'ANTE: Cannot commit a stake that expires before the current time commitment'
      );
      expect(await pool.getUnstakeAllowedTime(staker.address)).to.be.gte(expected1);
    });

    it('reverts on failing ERC20 transfer', async () => {
      await expect(
        pool.connect(unallowedStaker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT)
      ).to.be.revertedWith('SafeERC20: ERC20 operation did not succeed');
    });
  });

  describe('extendStakeLock()', () => {
    it('adds new commit extension to previous unlockTimestamp', async () => {
      const timelock = constants.ONE_DAY_IN_SECONDS;
      await pool.connect(staker).stake(constants.ONE_ETH, timelock);
      const initialUnlock = await pool.getUnstakeAllowedTime(staker.address);
      const additionalTime = constants.ONE_DAY_IN_SECONDS;
      await pool.connect(staker).extendStakeLock(additionalTime);
      const expected = initialUnlock.add(additionalTime);
      expect(await pool.getUnstakeAllowedTime(staker.address)).to.equal(expected);
    });

    it('cannot add new commit extension smaller than 24 hours', async () => {
      const timelock = constants.ONE_DAY_IN_SECONDS;
      await pool.connect(staker).stake(constants.ONE_ETH, timelock);
      const additionalTime = constants.ONE_DAY_IN_SECONDS / 2;
      await expect(pool.connect(staker).extendStakeLock(additionalTime)).to.be.revertedWith(
        'ANTE: Additional time must be greater than 24 hours'
      );
    });

    it('cannot add new commit extension greater than 730 days', async () => {
      const timelock = constants.ONE_DAY_IN_SECONDS;
      await pool.connect(staker).stake(constants.ONE_ETH, timelock);
      const additionalTime = constants.MAX_STAKE_COMMITMENT + 1;
      await expect(pool.connect(staker).extendStakeLock(additionalTime)).to.be.revertedWith(
        'ANTE: Additional time must be less than 730 days'
      );
    });

    it('reverts if sender is not a staker', async () => {
      const timelock = constants.ONE_DAY_IN_SECONDS;
      await pool.connect(staker).stake(constants.ONE_ETH, timelock);
      const additionalTime = constants.ONE_DAY_IN_SECONDS;
      await expect(pool.connect(staker_2).extendStakeLock(additionalTime)).to.be.revertedWith(
        'ANTE: Only an existing staker can extend the stake lock'
      );
    });

    it('emits ExtendStake event', async () => {
      const timelock = constants.ONE_DAY_IN_SECONDS;
      await pool.connect(staker).stake(constants.ONE_ETH, timelock);
      const initialUnlock = await pool.getUnstakeAllowedTime(staker.address);
      const additionalTime = constants.ONE_DAY_IN_SECONDS;
      const expected = initialUnlock.add(additionalTime);

      await expect(pool.connect(staker).extendStakeLock(additionalTime))
        .to.emit(pool, 'ExtendStake')
        .withArgs(staker.address, additionalTime, expected);
    });
  });

  describe('getStoredBalance', () => {
    before(async () => {
      localSnapshotId = await evmSnapshot();
    });

    beforeEach(async () => {
      await evmRevert(localSnapshotId);
      localSnapshotId = await evmSnapshot();
    });

    it('updates the balance properly on stake support', async () => {
      expect(await pool.getStoredBalance(staker.address, false)).to.be.equal(0);

      const commitTime = 60 * 60 * 24 * 90;

      await pool.connect(staker).stake(constants.ONE_ETH, commitTime);

      expect(await pool.getStoredBalance(staker.address, false)).to.be.equal(constants.ONE_ETH);
      expect(await pool.getStoredBalance(challenger.address, false)).to.be.equal(0);
      expect(await pool.getStoredBalance(staker.address, true)).to.be.equal(0);

      await pool.connect(staker).stake(constants.TWO_ETH, commitTime);

      expect(await pool.getStoredBalance(staker.address, false)).to.be.equal(constants.ONE_ETH.mul(3));
      expect(await pool.getStoredBalance(challenger.address, false)).to.be.equal(0);
      expect(await pool.getStoredBalance(staker.address, true)).to.be.equal(0);
    });

    it('updates the balance properly on stake challenge', async () => {
      // Stake needed to maintain minimum challenger payout ratio
      await pool.connect(staker).stake(constants.ONE_ETH.mul(20), constants.ONE_DAY_IN_SECONDS);
      expect(await pool.getStoredBalance(challenger.address, true)).to.be.equal(0);

      await pool.connect(challenger).registerChallenge(constants.ONE_ETH);
      const registerTime = await blockTimestamp();

      const confirmTime = registerTime + constants.CHALLENGER_TIMESTAMP_DELAY;
      await evmSetNextBlockTimestamp(confirmTime);
      await pool.connect(challenger).confirmChallenge();

      const { totalDecay: decay1 } = calculateDecay(constants.ONE_ETH, constants.CHALLENGER_TIMESTAMP_DELAY);
      const expectedChallengerBalance = constants.ONE_ETH.sub(decay1);

      expect(await pool.getStoredBalance(challenger.address, true)).to.be.equal(expectedChallengerBalance);
      expect(await pool.getStoredBalance(staker.address, true)).to.be.equal(0);
      expect(await pool.getStoredBalance(challenger.address, false)).to.be.equal(0);

      const someDelay = 10;
      const register2Time = confirmTime + someDelay;

      const { totalDecay: decay2 } = calculateDecay(expectedChallengerBalance, someDelay);
      const expectedChallengerBalance2 = expectedChallengerBalance.sub(decay2);

      await evmSetNextBlockTimestamp(register2Time);
      await pool.connect(challenger).registerChallenge(constants.HALF_ETH);

      expectAlmostEqual(
        await pool.getStoredBalance(challenger.address, true),
        expectedChallengerBalance2.add(constants.HALF_ETH),
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );

      const confirm2Time = register2Time + constants.CHALLENGER_TIMESTAMP_DELAY;
      await evmSetNextBlockTimestamp(confirm2Time);
      await pool.connect(challenger).confirmChallenge();

      const { totalDecay: decay3 } = calculateDecay(
        expectedChallengerBalance2.add(constants.HALF_ETH),
        constants.CHALLENGER_TIMESTAMP_DELAY
      );

      const expectedChallengerBalance3 = expectedChallengerBalance2.add(constants.HALF_ETH).sub(decay3);

      expectAlmostEqual(
        await pool.getStoredBalance(challenger.address, true),
        expectedChallengerBalance3,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
      expect(await pool.getStoredBalance(staker.address, true)).to.be.equal(0);
      expect(await pool.getStoredBalance(challenger.address, false)).to.be.equal(0);
    });
  });

  describe('getTotalStaked', () => {
    it('returns the expected values', async () => {
      const commitTime = 60 * 60 * 24 * 90;
      expect(await pool.getTotalStaked()).to.equal(0);

      const initialStake = constants.ONE_ETH.mul(20);
      await pool.connect(staker).stake(initialStake, commitTime);
      expect(await pool.getTotalStaked()).to.equal(initialStake);

      //decay does not accrue in same block as stake challenge
      await pool.connect(challenger).registerChallenge(constants.ONE_ETH);
      const registerTime = await blockTimestamp();
      expect(await pool.getTotalStaked()).to.equal(initialStake);

      const confirmTime = registerTime + constants.CHALLENGER_TIMESTAMP_DELAY;
      await evmSetNextBlockTimestamp(confirmTime);

      await pool.connect(challenger).confirmChallenge();
      const postConfirmBlockTimestamp = await blockTimestamp();
      expect(confirmTime).to.equal(postConfirmBlockTimestamp);

      const totalStaked = await pool.getTotalStaked();
      const { stakerDecayShare, totalDecay } = calculateDecay(constants.ONE_ETH, confirmTime - registerTime);

      const expected = initialStake.add(stakerDecayShare);

      expect(totalStaked).to.equal(expected);

      const stakeTime = registerTime + constants.CHALLENGER_TIMESTAMP_DELAY * 2;

      await evmSetNextBlockTimestamp(stakeTime);
      await pool.connect(staker_2).stake(constants.ONE_ETH, commitTime);
      const postStakeBlockTimestamp = await blockTimestamp();
      expect(postStakeBlockTimestamp).to.equal(stakeTime);

      // Calculate additional decay between challenger confirmation and second stake
      const { stakerDecayShare: postConfirmDecayShare } = calculateDecay(
        constants.ONE_ETH.sub(totalDecay),
        stakeTime - confirmTime
      );

      //account for additional decay for challenger side
      expectAlmostEqual(
        await pool.getTotalStaked(),
        expected.add(postConfirmDecayShare).add(constants.ONE_ETH),
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
    });
  });

  describe('getTotalChallengerStaked', () => {
    it('returns the expected values', async () => {
      // Stake needed to maintain minimum challenger payout ratio
      const stakeAmount = constants.ONE_ETH.mul(20);
      await pool.connect(staker).stake(stakeAmount, constants.ONE_DAY_IN_SECONDS);
      const stakeTime = await blockTimestamp();
      expect(await pool.getTotalChallengerStaked()).to.equal(0);
      const someDelay = 10;

      const registerTime = stakeTime + someDelay;
      await evmSetNextBlockTimestamp(registerTime);
      await pool.connect(challenger).registerChallenge(constants.ONE_ETH);
      const confirmTime = registerTime + constants.CHALLENGER_TIMESTAMP_DELAY;
      await evmSetNextBlockTimestamp(confirmTime);
      await pool.connect(challenger).confirmChallenge();

      const { totalDecay: decay1 } = calculateDecay(constants.ONE_ETH, constants.CHALLENGER_TIMESTAMP_DELAY);
      const expectedChallenge1 = constants.ONE_ETH.sub(decay1);

      expect(await pool.getTotalChallengerStaked()).to.equal(expectedChallenge1);

      const register2Time = confirmTime + someDelay;
      await evmSetNextBlockTimestamp(register2Time);
      await pool.connect(challenger_2).registerChallenge(constants.ONE_ETH);

      const { totalDecay: decay2 } = calculateDecay(expectedChallenge1, someDelay);
      const expectedChallenge2 = expectedChallenge1.add(constants.ONE_ETH).sub(decay2);
      expectAlmostEqual(
        await pool.getTotalChallengerStaked(),
        expectedChallenge2,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );

      const confirm2Time = register2Time + constants.CHALLENGER_TIMESTAMP_DELAY;
      await evmSetNextBlockTimestamp(confirm2Time);
      await pool.connect(challenger_2).confirmChallenge();

      const { totalDecay: decay3 } = calculateDecay(expectedChallenge2, constants.CHALLENGER_TIMESTAMP_DELAY);

      //account for addition decay for challenger side on initial one token challenge stake
      const expected = expectedChallenge2.sub(decay3);
      expectAlmostEqual(await pool.getTotalChallengerStaked(), expected, constants.WEI_ROUNDING_ERROR_TOLERANCE);
    });
  });

  describe('numUsers', () => {
    it('returns the number of unique users (stakers + challengers)', async () => {
      const commitTime = 60 * 60 * 24 * 90;
      const stakingInfo = await pool.stakingInfo();
      const challengerInfo = await pool.challengerInfo();

      await pool.connect(staker).stake(constants.ONE_ETH.mul(50), commitTime);

      await pool.connect(challenger).registerChallenge(constants.HALF_ETH);
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await pool.connect(challenger).confirmChallenge();

      expect((await pool.stakingInfo()).numUsers).to.equal(stakingInfo.numUsers.add(1));
      expect((await pool.challengerInfo()).numUsers).to.equal(challengerInfo.numUsers.add(1));

      await pool.connect(staker).stake(constants.ONE_ETH, commitTime);

      await pool.connect(challenger).registerChallenge(constants.HALF_ETH);
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await pool.connect(challenger).confirmChallenge();

      expect((await pool.stakingInfo()).numUsers).to.equal(stakingInfo.numUsers.add(1));
      expect((await pool.challengerInfo()).numUsers).to.equal(challengerInfo.numUsers.add(1));

      await pool.connect(staker_2).stake(constants.ONE_ETH, commitTime);

      await pool.connect(challenger_2).registerChallenge(constants.HALF_ETH);
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await pool.connect(challenger_2).confirmChallenge();

      expect((await pool.stakingInfo()).numUsers).to.equal(stakingInfo.numUsers.add(2));
      expect((await pool.challengerInfo()).numUsers).to.equal(challengerInfo.numUsers.add(2));
    });
  });

  describe('getCheckTestAllowedBlock', () => {
    it('returns the expected block number after challenger stake', async () => {
      // Stake needed to maintain minimum challenger payout ratio
      const stakeAmount = constants.ONE_ETH.mul(20);
      await pool.connect(staker).stake(stakeAmount, constants.ONE_DAY_IN_SECONDS);
      await pool.connect(challenger).registerChallenge(constants.ONE_ETH);
      const block = await blockNumber();

      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await pool.connect(challenger).confirmChallenge();

      expect(await pool.getCheckTestAllowedBlock(challenger.address)).to.equal(
        block + constants.CHALLENGER_BLOCK_DELAY
      );
    });
  });

  describe('stake', () => {
    it('should transfer tokens into contract on stake support', async () => {
      const commitTime = 60 * 60 * 24 * 90;
      const orig_wallet_balance = await staker.getBalance();
      const orig_wallet_token_balance = await token.balanceOf(staker.address);
      const orig_contract_token_balance = await token.balanceOf(pool.address);

      const stakeAmount = constants.ONE_ETH.mul(20);
      const txpromise = await pool.connect(staker).stake(stakeAmount, commitTime);
      const gasCost = await calculateGasUsed(txpromise);

      const after_wallet_balance = await staker.getBalance();
      const after_wallet_token_balance = await token.balanceOf(staker.address);
      const after_contract_token_balance = await token.balanceOf(pool.address);

      // staker wallet balance is 1 token lower
      expect(after_wallet_balance).to.be.equal(orig_wallet_balance.sub(gasCost));
      expect(after_wallet_token_balance).to.be.equal(orig_wallet_token_balance.sub(stakeAmount));
      // contract wallet balance is 1 token higher
      expect(after_contract_token_balance).to.be.equal(orig_contract_token_balance.add(stakeAmount));
    });

    it('should emit stake event on stake support with proper args', async () => {
      const commitTime = 60 * 60 * 24 * 90;
      const stakeAmount = constants.ONE_ETH.div(2);

      await expect(pool.connect(staker).stake(stakeAmount, commitTime))
        .to.emit(pool, 'Stake')
        .withArgs(staker.address, stakeAmount, commitTime);
    });

    it('does not allow staking amount below minSupporterStake', async () => {
      const commitTime = 60 * 60 * 24 * 90;
      const minSupporterStake = await pool.minSupporterStake();
      const stakeAmount = minSupporterStake.sub(1);

      await expect(pool.connect(staker).stake(stakeAmount, commitTime)).to.be.revertedWith(
        'ANTE: Supporter must stake more than minSupporterStake'
      );
    });
  });

  describe('registerChallenge', () => {
    it('challengers cannot stake less than minChallengerStake', async () => {
      await expect(pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(101))).to.be.revertedWith(
        'ANTE: Challenger must stake more than minChallengerStake'
      );
    });

    it('should transfer tokens into contract on stake challenge', async () => {
      // Stake needed to maintain minimum challenger payout ratio
      const stakeAmount = constants.ONE_ETH.mul(20);
      await pool.connect(staker).stake(stakeAmount, constants.ONE_DAY_IN_SECONDS);

      const orig_wallet_balance = await challenger.getBalance();
      const orig_wallet_token_balance = await token.balanceOf(challenger.address);
      const orig_contract_token_balance = await token.balanceOf(pool.address);

      const txpromise = await pool.connect(challenger).registerChallenge(constants.ONE_ETH);
      const gasCost = await calculateGasUsed(txpromise);

      const after_wallet_balance = await challenger.getBalance();
      const after_wallet_token_balance = await token.balanceOf(challenger.address);
      const after_contract_token_balance = await token.balanceOf(pool.address);

      // challenger wallet balance is 1 token lower
      expect(after_wallet_balance).to.be.equal(orig_wallet_balance.sub(gasCost));
      expect(after_wallet_token_balance).to.be.equal(orig_wallet_token_balance.sub(constants.ONE_ETH));
      // contract wallet balance is 1 token higher
      expect(after_contract_token_balance).to.be.equal(orig_contract_token_balance.add(constants.ONE_ETH));
    });

    it('should emit register challenge event on stake challenge with proper args', async () => {
      // Stake needed to maintain minimum challenger payout ratio
      const stakeAmount = constants.ONE_ETH.mul(20);
      await pool.connect(staker).stake(stakeAmount, constants.ONE_DAY_IN_SECONDS);

      const challengeAmount = constants.ONE_ETH.div(2);

      await expect(pool.connect(challenger).registerChallenge(challengeAmount))
        .to.emit(pool, 'RegisterChallenge')
        .withArgs(challenger.address, challengeAmount);
    });
  });

  describe('confirmChallenge', () => {
    it('should emit confirm challenge event on challenge confirmed with proper args', async () => {
      // Stake needed to maintain minimum challenger payout ratio
      const stakeAmount = constants.ONE_ETH.mul(20);
      await pool.connect(staker).stake(stakeAmount, constants.ONE_DAY_IN_SECONDS);

      const challengeAmount = constants.ONE_ETH;

      await pool.connect(challenger).registerChallenge(challengeAmount);
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      const { totalDecay: decay } = calculateDecay(challengeAmount, constants.CHALLENGER_TIMESTAMP_DELAY);

      const expectedConfirmingAmount = challengeAmount.sub(decay);

      await expect(pool.connect(challenger).confirmChallenge())
        .to.emit(pool, 'ConfirmChallenge')
        .withArgs(challenger.address, expectedConfirmingAmount);
    });
  });
});
