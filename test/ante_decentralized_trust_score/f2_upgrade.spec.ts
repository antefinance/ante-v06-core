import { basicFixture, BasicFixture } from '../fixtures/basic.fixture';
import { evmSnapshot, evmRevert, evmIncreaseTime } from '../helpers';

import { Contract } from 'ethers';

import hre, { ethers, upgrades } from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider } = waffle;
import * as constants from '../constants';

import { expect } from 'chai';

describe('AnteDecentralizedTrustScoreV1 UUPSUpgradeable', () => {
  const wallets = provider.getWallets();
  const [_, staker, challenger] = wallets;

  let deployment: BasicFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let pool: Contract;
  let trustScoreV1Contract: Contract;

  before(async () => {
    deployment = await loadFixture(basicFixture);

    const factory = await ethers.getContractFactory('AnteDecentralizedTrustScoreV1');
    trustScoreV1Contract = await upgrades.deployProxy(factory, [], { kind: 'uups' });
    await trustScoreV1Contract.deployed();
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

  it('can be upgraded with a different implementation', async () => {
    await pool.connect(staker).stake(constants.TWO_ETH, constants.MIN_STAKE_COMMITMENT);

    await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
    await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
    await pool.connect(challenger).confirmChallenge();

    expect(await trustScoreV1Contract.getTrustScore(pool.address)).to.be.equal(95);

    const factory = await ethers.getContractFactory('AdamsDecentralizedTowelScore');
    trustScoreV1Contract = await upgrades.upgradeProxy(trustScoreV1Contract.address, factory, { kind: 'uups' });
    await trustScoreV1Contract.deployed();

    expect(await trustScoreV1Contract.getTrustScore(pool.address)).to.be.equal(42);
  });
});
