import { basicFixture, BasicFixture } from '../fixtures/basic.fixture';
import {
  evmSnapshot,
  evmRevert,
  blockTimestamp,
  evmSetNextBlockTimestamp,
  calculateDecay,
  getLogicContract,
} from '../helpers';

import { BigNumber } from 'ethers';

import * as constants from '../constants';

import hre from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider } = waffle;

import { expect } from 'chai';
import { AntePoolLogic, IAntePool } from '../../typechain';

describe('Challenger Cap', function () {
  const wallets = provider.getWallets();
  const [staker, challenger, staker_2, challenger_2] = wallets;

  let deployment: BasicFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let pool: IAntePool;
  let maxChallenge: BigNumber;
  let totalChallenged: BigNumber;
  let challengerPayoutRatio: BigNumber;

  before(async () => {
    deployment = await loadFixture(basicFixture);
    globalSnapshotId = await evmSnapshot();

    pool = deployment.oddBlockDeployment.pool;
    await pool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
    challengerPayoutRatio = await pool.challengerPayoutRatio();
    maxChallenge = (await pool.getTotalStaked()).div(challengerPayoutRatio);
    totalChallenged = await pool.getTotalChallengerStaked();

    snapshotId = await evmSnapshot();
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
  });

  it('can challenge up to challenger cap', async () => {
    expect(totalChallenged).to.be.lt(maxChallenge);

    const challengeableAmount = maxChallenge.sub(totalChallenged);
    expect(challengeableAmount).to.be.gt(0);
    await pool.connect(challenger).stake(challengeableAmount, constants.MIN_STAKE_COMMITMENT);

    expect(await pool.getTotalChallengerStaked()).to.be.lte(maxChallenge);
  });

  it('should revert any challenge exceeding the pool ratio', async () => {
    const challengeableAmount = maxChallenge.sub(totalChallenged);
    expect(challengeableAmount).to.be.gt(0);
    await expect(pool.connect(challenger).registerChallenge(challengeableAmount.add(1))).to.be.revertedWith(
      'ANTE: Challenge amount exceeds maximum challenge ratio.'
    );
  });

  it('should revert any challenge if stakers unstake below ratio', async () => {
    const minStake = await pool.minChallengerStake();
    const initialStake = constants.ONE_ETH;

    // Challenger stakes halfway to limit
    await pool.connect(challenger).registerChallenge(maxChallenge.sub(totalChallenged).div(2));
    const registerTimestamp = await blockTimestamp();
    const unstakeTimestamp = registerTimestamp + constants.MIN_STAKE_COMMITMENT;
    await evmSetNextBlockTimestamp(unstakeTimestamp);

    const { stakerDecayShare } = calculateDecay(initialStake, unstakeTimestamp - registerTimestamp);

    // Staker unstakes half of total staked amount, causing the pool ratio to be reached
    await pool.connect(staker).unstake(initialStake.add(stakerDecayShare).div(2), false);

    // Further challenges are rejected
    await expect(pool.connect(challenger).registerChallenge(minStake)).to.be.revertedWith(
      'ANTE: Challenge amount exceeds maximum challenge ratio.'
    );
  });
});
