import {
  evmSnapshot,
  evmRevert,
  evmMineBlocks,
  evmIncreaseTime,
  deployTestAndPool,
  evmSetNextBlockTimestamp,
  blockTimestamp,
  calculateDecay,
  expectAlmostEqual,
} from '../helpers';
import AntePoolFactoryArtifact from '../../artifacts/contracts/AntePoolFactory.sol/AntePoolFactory.json';

import * as constants from '../constants';

import hre from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider, deployContract } = waffle;

import { expect } from 'chai';
import {
  AnteAlwaysPassTest__factory,
  AnteERC20,
  AntePoolFactory,
  AntePoolFactory__factory,
  IAntePool,
} from '../../typechain';
import { calculateGasUsed } from '../../scripts/helpers';
import { multiPoolSameTest } from '../fixtures/multiPoolSameTest.fixture';
import { BasicFixture, basicFixture } from '../fixtures/basic.fixture';
import { BigNumber } from 'ethers';

describe('Test Author Payout', function () {
  const wallets = provider.getWallets();
  const [deployer, author, staker, challenger, staker2, challenger2] = wallets;

  let deployment: BasicFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
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

  describe('initialize', () => {
    it('sets the provided reward rate', async () => {
      const poolFactory = (await deployContract(deployer, AntePoolFactoryArtifact, [
        deployment.controller.address,
      ])) as AntePoolFactory;
      const factory = (await hre.ethers.getContractFactory(
        'AnteAlwaysPassTest',
        deployer
      )) as AnteAlwaysPassTest__factory;

      const testAuthorRewardRate = 7;
      const { pool } = await deployTestAndPool(deployer, poolFactory, factory, [], {
        tokenAddress: token.address,
        testAuthorRewardRate,
      });

      expect(await pool.testAuthorRewardRate()).to.equal(testAuthorRewardRate);
    });

    it('reverts if author reward rate is less than 0 or greater than MAX_AUTHOR_REWARD_RATE', async () => {
      const factory = (await hre.ethers.getContractFactory(
        'AnteAlwaysPassTest',
        deployer
      )) as AnteAlwaysPassTest__factory;

      const testContract = await factory.deploy();
      await testContract.deployed();

      const anteFactory = (await hre.ethers.getContractFactory(
        'AntePoolFactory',
        deployer
      )) as AntePoolFactory__factory;
      const poolFactory: AntePoolFactory = await anteFactory.deploy(deployment.controller.address);
      await poolFactory.deployed();

      await expect(
        poolFactory.createPool(
          testContract.address,
          token.address,
          constants.CHALLENGER_PAYOUT_RATIO,
          constants.ANNUAL_DECAY_RATE,
          -1
        )
      ).to.be.reverted;

      await expect(
        poolFactory.createPool(
          testContract.address,
          token.address,
          constants.CHALLENGER_PAYOUT_RATIO,
          constants.ANNUAL_DECAY_RATE,
          constants.MAX_AUTHOR_REWARD_RATE + 1
        )
      ).to.be.revertedWith('ANTE: Reward rate cannot be greater than MAX_AUTHOR_REWARD_RATE');
    });
  });

  describe('getTestAuthorReward', () => {
    it('computes the author rewards according to the provided reward rate', async () => {
      const someDelay = constants.ONE_DAY_IN_SECONDS;
      const challengeAmount = constants.ONE_ETH.div(10);

      expect(await pool.getStoredBalance(author.address, false)).to.equal(0);

      await pool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
      await pool.connect(challenger).registerChallenge(challengeAmount);
      const registerTime = await blockTimestamp();

      const confirmTime = registerTime + constants.CHALLENGER_TIMESTAMP_DELAY;
      await evmSetNextBlockTimestamp(confirmTime);
      await pool.connect(challenger).confirmChallenge();

      // Accumulate more decay
      await evmSetNextBlockTimestamp(confirmTime + someDelay);
      await evmMineBlocks(1);

      // Decay until confirm
      const { totalDecay, authorDecayShare: authorDecayShare1 } = calculateDecay(
        challengeAmount,
        confirmTime - registerTime
      );

      // Decay between confirm and now
      const { authorDecayShare: authorDecayShare2 } = calculateDecay(challengeAmount.sub(totalDecay), someDelay);

      expect(await pool.getTestAuthorReward()).to.equal(authorDecayShare1.add(authorDecayShare2));
    });

    it('returns 0 if there are no challengers', async () => {
      const minedBlocks = 10;

      expect(await pool.getStoredBalance(author.address, false)).to.equal(0);

      await pool.connect(staker).stake(constants.ONE_ETH.mul(2), constants.MIN_STAKE_COMMITMENT);

      await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS);
      await evmMineBlocks(minedBlocks);

      expect(await pool.getTestAuthorReward()).to.equal(0);
    });

    it('returns correct reward amount after multiple claims', async () => {
      await pool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
      await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(100));
      let totalChallenged = constants.ONE_ETH.div(100);
      const registerTime = await blockTimestamp();

      const confirmTime = registerTime + constants.CHALLENGER_TIMESTAMP_DELAY;
      await evmSetNextBlockTimestamp(confirmTime);
      await pool.connect(challenger).confirmChallenge();

      const { totalDecay: totalDecay1, authorDecayShare: authorShare1 } = calculateDecay(
        totalChallenged,
        constants.CHALLENGER_TIMESTAMP_DELAY
      );
      totalChallenged = totalChallenged.sub(totalDecay1);

      expect(await pool.getTestAuthorReward()).to.equal(authorShare1);

      const claimTime = confirmTime + 1;
      await evmSetNextBlockTimestamp(claimTime);
      await pool.connect(author).claimReward();
      expect(await pool.getTestAuthorReward()).to.equal(0);
      // Subtract the decay accumulated during claimReward
      const { totalDecay: totalDecay2 } = calculateDecay(totalChallenged, 1);
      totalChallenged = totalChallenged.sub(totalDecay2);

      const someDelay2 = constants.ONE_DAY_IN_SECONDS * 2;

      await evmSetNextBlockTimestamp(claimTime + someDelay2);
      await evmMineBlocks(1);

      const { totalDecay: totalDecay3, authorDecayShare: authorShare3 } = calculateDecay(totalChallenged, someDelay2);
      totalChallenged = totalChallenged.sub(totalDecay3);

      expect(await pool.getTestAuthorReward()).to.equal(authorShare3);
    });
  });

  describe('getStoredBalance', () => {
    it('does not include the reward when author has no stake', async () => {
      expect(await pool.getStoredBalance(author.address, false)).to.equal(0);

      await pool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
      await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(100));
      const registerTime = await blockTimestamp();
      const confirmTime = registerTime + constants.CHALLENGER_TIMESTAMP_DELAY;
      await evmSetNextBlockTimestamp(confirmTime);
      await pool.connect(challenger).confirmChallenge();

      await evmSetNextBlockTimestamp(confirmTime + constants.ONE_DAY_IN_SECONDS);
      await evmMineBlocks(1);

      expect(await pool.getStoredBalance(author.address, false)).to.equal(0);
    });

    it('does not include the reward when author has staked', async () => {
      expect(await pool.getStoredBalance(author.address, false)).to.equal(0);

      const stakeAmount = constants.ONE_ETH;
      await pool.connect(author).stake(stakeAmount, constants.MIN_STAKE_COMMITMENT);
      await pool.connect(staker).stake(stakeAmount, constants.MIN_STAKE_COMMITMENT);
      await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(100));
      let totalChallenged = constants.ONE_ETH.div(100);
      const registerTime = await blockTimestamp();
      const confirmTime = registerTime + constants.CHALLENGER_TIMESTAMP_DELAY;
      await evmSetNextBlockTimestamp(confirmTime);
      await pool.connect(challenger).confirmChallenge();

      const { totalDecay, stakerDecayShare: stakerShare1 } = calculateDecay(
        totalChallenged,
        confirmTime - registerTime
      );
      totalChallenged = totalChallenged.sub(totalDecay);

      // let some decay accumulate
      await evmSetNextBlockTimestamp(confirmTime + constants.ONE_DAY_IN_SECONDS);
      await evmMineBlocks(1);

      const { stakerDecayShare: stakerShare2 } = calculateDecay(totalChallenged, +constants.ONE_DAY_IN_SECONDS);

      expect(await pool.getStoredBalance(author.address, false)).to.be.equal(
        stakeAmount.add(stakerShare1.add(stakerShare2).div(2))
      );
    });

    it('does not include the rewards when author is a challenger', async () => {
      // Need more stake to satisfy the challenger ratio
      await pool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);

      const authorChallengeAmount = constants.ONE_ETH.div(100);
      expect(await pool.getStoredBalance(author.address, false)).to.equal(0);

      await pool.connect(author).registerChallenge(authorChallengeAmount);
      let totalChallenged = authorChallengeAmount;
      const registerTime = await blockTimestamp();
      const confirmTime = registerTime + constants.CHALLENGER_TIMESTAMP_DELAY;
      await evmSetNextBlockTimestamp(confirmTime);
      await pool.connect(author).confirmChallenge();
      const { totalDecay: totalDecay1 } = calculateDecay(totalChallenged, confirmTime - registerTime);
      totalChallenged = totalChallenged.sub(totalDecay1);

      const registerTime2 = confirmTime + 1;
      await evmSetNextBlockTimestamp(registerTime2);
      await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(100));

      const { totalDecay: totalDecay2 } = calculateDecay(totalChallenged, 1);
      totalChallenged = totalChallenged.sub(totalDecay2);

      const confirmTime2 = registerTime2 + constants.CHALLENGER_TIMESTAMP_DELAY;
      await evmSetNextBlockTimestamp(confirmTime2);
      await pool.connect(challenger).confirmChallenge();

      const { totalDecay: totalDecay3 } = calculateDecay(totalChallenged, constants.CHALLENGER_TIMESTAMP_DELAY);
      totalChallenged = totalChallenged.sub(totalDecay3);

      // let some decay accumulate
      await evmSetNextBlockTimestamp(confirmTime2 + constants.ONE_DAY_IN_SECONDS);
      await evmMineBlocks(1);

      const { totalDecay: totalDecay4 } = calculateDecay(totalChallenged, constants.ONE_DAY_IN_SECONDS);

      const expectedAuthorBalance = authorChallengeAmount
        .sub(totalDecay1)
        .sub(totalDecay2)
        .sub(totalDecay3)
        .sub(totalDecay4);

      expectAlmostEqual(
        await pool.getStoredBalance(author.address, true),
        expectedAuthorBalance,
        constants.WEI_ROUNDING_ERROR_TOLERANCE
      );
    });
  });

  describe('claimReward', () => {
    it('reverts if signer is not the test author', async () => {
      await expect(pool.connect(staker).claimReward()).to.be.revertedWith('ANTE: Only author can claim');
    });

    it('reverts if there are no rewards to be claimed', async () => {
      await expect(pool.connect(author).claimReward()).to.be.revertedWith('ANTE: No reward');
    });

    it('reverts if there are no challengers', async () => {
      await pool.connect(author).stake(constants.ONE_ETH.mul(2), constants.MIN_STAKE_COMMITMENT);

      await evmSetNextBlockTimestamp((await blockTimestamp()) + constants.ONE_DAY_IN_SECONDS);

      await expect(pool.connect(author).claimReward()).to.be.revertedWith('ANTE: No reward');
    });

    it('transfers author claimed rewards to his wallet', async () => {
      const someDelay = constants.ONE_DAY_IN_SECONDS;
      const authorBalance = await author.getBalance();
      const authorTokenBalance = await token.balanceOf(author.address);

      expect(await pool.getStoredBalance(author.address, false)).to.equal(0);

      await pool.connect(staker).stake(constants.ONE_ETH.mul(100), constants.MIN_STAKE_COMMITMENT);
      await pool.connect(challenger).registerChallenge(constants.ONE_ETH);
      const registerTime = await blockTimestamp();
      const confirmTime = registerTime + constants.CHALLENGER_TIMESTAMP_DELAY;
      await evmSetNextBlockTimestamp(confirmTime);
      await pool.connect(challenger).confirmChallenge();

      const { totalDecay, authorDecayShare: authorDecayShare1 } = calculateDecay(
        constants.ONE_ETH,
        constants.CHALLENGER_TIMESTAMP_DELAY
      );

      const claimTime = confirmTime + someDelay;
      await evmSetNextBlockTimestamp(claimTime);
      const tx = await pool.connect(author).claimReward();
      const gasCost = await calculateGasUsed(tx);

      const { authorDecayShare: authorDecayShare2 } = calculateDecay(constants.ONE_ETH.sub(totalDecay), someDelay);

      expect(await author.getBalance()).to.be.equal(authorBalance.sub(gasCost));
      expect(await token.balanceOf(author.address)).to.be.equal(
        authorTokenBalance.add(authorDecayShare1).add(authorDecayShare2)
      );
      expect(await pool.getTestAuthorReward()).to.be.equal(0);
    });

    it('transfers the correct amount if author performs multiple claims', async () => {
      let someDelay = constants.ONE_DAY_IN_SECONDS;
      const authorTokenBalance = await token.balanceOf(author.address);

      await pool.connect(staker).stake(constants.ONE_ETH.mul(100), constants.MIN_STAKE_COMMITMENT);
      await pool.connect(challenger).registerChallenge(constants.ONE_ETH);
      let totalChallenged = constants.ONE_ETH;
      const registerTime = await blockTimestamp();
      const confirmTime = registerTime + constants.CHALLENGER_TIMESTAMP_DELAY;
      await evmSetNextBlockTimestamp(confirmTime);
      await pool.connect(challenger).confirmChallenge();

      const { totalDecay, authorDecayShare: authorDecayShare1 } = calculateDecay(
        totalChallenged,
        constants.CHALLENGER_TIMESTAMP_DELAY
      );
      totalChallenged = totalChallenged.sub(totalDecay);

      const rewardTime = confirmTime + someDelay;
      await evmSetNextBlockTimestamp(rewardTime);
      await pool.connect(author).claimReward();

      const { totalDecay: totalDecay2, authorDecayShare: authorDecayShare2 } = calculateDecay(
        totalChallenged,
        someDelay
      );
      totalChallenged = totalChallenged.sub(totalDecay2);

      const expectedAuthorRewardClaim1 = authorDecayShare1.add(authorDecayShare2);
      expect(await token.balanceOf(author.address)).to.be.equal(authorTokenBalance.add(expectedAuthorRewardClaim1));

      someDelay = 2 * constants.ONE_DAY_IN_SECONDS;
      await evmSetNextBlockTimestamp(rewardTime + someDelay);
      await pool.connect(author).claimReward();

      const { totalDecay: totalDecay3, authorDecayShare: authorDecayShare3 } = calculateDecay(
        totalChallenged,
        someDelay
      );
      totalChallenged = totalChallenged.sub(totalDecay3);

      expect(await token.balanceOf(author.address)).to.be.equal(
        authorTokenBalance.add(expectedAuthorRewardClaim1).add(authorDecayShare3)
      );
    });

    it('accumulates rewards in multiple pools and transfers all tokens after all stakers and challengers have unstaked their funds', async () => {
      let multiPoolDeployment = await multiPoolSameTest();
      const { token, pool0, pool1, pool2 } = multiPoolDeployment;

      const initAuthorBalance = await token.balanceOf(author.address);

      const decayPeriod = 20 * constants.ONE_DAY_IN_SECONDS;

      await evmIncreaseTime(decayPeriod);
      await evmMineBlocks(1);

      // Withdraw all funds from P0
      await pool0.connect(challenger).unstakeAll(true);
      await pool0.connect(challenger2).unstakeAll(true);

      await pool0.connect(staker).unstakeAll(false);
      await pool0.connect(staker2).unstakeAll(false);

      await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS + 1);
      await pool0.connect(staker).withdrawStake();
      await pool0.connect(staker2).withdrawStake();
      const expectedAuthorRewardClaim0 = await pool0.getTestAuthorReward();

      // Withdraw all funds from P1
      await pool1.connect(challenger).unstakeAll(true);

      await pool1.connect(staker).unstakeAll(false);
      await pool1.connect(staker2).unstakeAll(false);

      await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS + 1);
      await pool1.connect(staker).withdrawStake();
      await pool1.connect(staker2).withdrawStake();
      const expectedAuthorRewardClaim1 = await pool1.getTestAuthorReward();

      // Withdraw all funds from P2
      await pool2.connect(staker).unstakeAll(false);
      await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS + 1);
      await pool2.connect(staker).withdrawStake();

      await pool0.connect(author).claimReward();
      expect(await token.balanceOf(author.address)).to.be.equal(initAuthorBalance.add(expectedAuthorRewardClaim0));

      await pool1.connect(author).claimReward();
      expect(await token.balanceOf(author.address)).to.be.equal(
        initAuthorBalance.add(expectedAuthorRewardClaim0).add(expectedAuthorRewardClaim1)
      );

      await expect(pool2.connect(author).claimReward()).to.be.revertedWith('ANTE: No reward');

      expectAlmostEqual(await token.balanceOf(pool0.address), BigNumber.from(0), 12);
      expectAlmostEqual(await token.balanceOf(pool1.address), BigNumber.from(0), 12);
      expectAlmostEqual(await token.balanceOf(pool2.address), BigNumber.from(0), 12);
    });
  });
});
