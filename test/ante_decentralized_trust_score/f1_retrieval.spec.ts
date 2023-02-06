import { evmSnapshot, evmRevert, evmIncreaseTime, evmMineBlocks, deployPool } from '../helpers';

import { Contract } from 'ethers';

import hre, { ethers, upgrades } from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider } = waffle;
import * as constants from '../constants';

import { expect } from 'chai';
import { conditionalTestFixture, ConditionalTestFixture } from '../fixtures/conditionalTest.fixture';
import { AnteConditionalTest, IAnteDecentralizedTrustScoreV1, IAntePool } from '../../typechain';

describe('AnteDecentralizedTrustScoreV1: Can retrieve the trust score', () => {
  const wallets = provider.getWallets();
  const [, , staker, challenger] = wallets;

  let deployment: ConditionalTestFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let pool: IAntePool;
  let test: AnteConditionalTest;
  let trustScoreV1Contract: IAnteDecentralizedTrustScoreV1;

  before(async () => {
    deployment = await loadFixture(conditionalTestFixture);

    const factory = await ethers.getContractFactory('AnteDecentralizedTrustScoreV1');
    trustScoreV1Contract = (await upgrades.deployProxy(factory, [], {
      kind: 'uups',
    })) as IAnteDecentralizedTrustScoreV1;
    await trustScoreV1Contract.deployed();
    globalSnapshotId = await evmSnapshot();
    snapshotId = await evmSnapshot();

    pool = deployment.conditionalTestDeployment.pool;
    test = deployment.conditionalTestDeployment.test;
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
  });

  describe('getTrustScore', () => {
    it('is calculated as expected', async () => {
      await pool.connect(staker).stake(constants.TWO_ETH, constants.MIN_STAKE_COMMITMENT);

      await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await pool.connect(challenger).confirmChallenge();

      const totalStaked = (await pool.stakingInfo()).totalAmount;
      const totalChallenged = (await pool.challengerInfo()).totalAmount;
      const totalPendingWithdraw = await pool.getTotalPendingWithdraw();

      const support = totalStaked.add(totalPendingWithdraw);
      const tvl = support.add(totalChallenged);
      const trustScore = support.mul(100).div(tvl);

      expect(await trustScoreV1Contract.getTrustScore(pool.address)).to.be.equal(trustScore);
    });

    it('returns 0 for new pool', async () => {
      const newPool = await deployPool(deployment.poolFactory, test.address, {
        tokenAddress: deployment.token.address,
        testAuthorRewardRate: 0,
      });

      expect(await trustScoreV1Contract.getTrustScore(newPool.address)).to.be.equal(0);
    });

    it('Reverts on invalid pool address', async () => {
      await expect(trustScoreV1Contract.getTrustScore(trustScoreV1Contract.address)).to.be.reverted;
    });

    it('returns 0 for failed pool', async () => {
      await test.setWillFail(true);
      await pool.connect(challenger).checkTest();

      expect(await trustScoreV1Contract.getTrustScore(pool.address)).to.be.equal(0);
    });
  });
});
