import hre from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider } = waffle;

import { AnteAVLDropTest__factory, AnteAVLDropTest, AnteConditionalTest, AnteERC20, IAntePool } from '../../typechain';

import { Contract } from 'ethers';

import { evmSnapshot, evmRevert, evmIncreaseTime } from '../helpers';
import { expect } from 'chai';
import { multiPoolTestFixture, MultiPoolTestFixture } from '../fixtures/multiPoolWithStakeChallenge.fixture';
import * as constants from '../constants';

describe('AnteAVLDropTest', function () {
  let test: AnteAVLDropTest;

  let deployment: MultiPoolTestFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let oddBlockPool: IAntePool;
  let usdcSupplyPool: IAntePool;
  let conditionalTest: AnteConditionalTest;
  let conditionalPool: IAntePool;
  let token: AnteERC20;

  const wallets = provider.getWallets();
  const [deployer, _author, staker, challenger, staker_2] = wallets;

  before(async () => {
    /* Set up the following state:
     * Ante Test           Stake             Challenge
     * -----------------------------------------------
     * AnteOddBlockTest    1 ETH (unlocked)    500 ETH
     * AnteUSDCSupplyTest  1 ETH                 1 ETH
     * AnteConditionalTest   1 ETH                 1 ETH
     */
    deployment = await loadFixture(multiPoolTestFixture);

    // Set up convenience variables
    oddBlockPool = deployment.oddBlockDeployment.pool;
    usdcSupplyPool = deployment.usdcSupplyTestDeployment.pool;
    conditionalTest = deployment.conditionalTestDeployment.test;
    conditionalPool = deployment.conditionalTestDeployment.pool;
    token = deployment.token;

    const poolAddresses = [oddBlockPool.address, usdcSupplyPool.address, conditionalPool.address];

    // Deploy AnteAVLDropTest
    const factory = (await hre.ethers.getContractFactory('AnteAVLDropTest', deployer)) as AnteAVLDropTest__factory;
    test = await factory.deploy(poolAddresses);
    await test.deployed();

    globalSnapshotId = await evmSnapshot();
    snapshotId = await evmSnapshot();
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
  });

  // Check test passes immediately after deploy
  it('should pass', async () => {
    expect(await test.checkTestPasses()).to.be.true;
  });

  // Check totalAVL = sum of the pool balances in tested contracts ("sub-pools")
  it('currentAVL = sum of tested contract AVLs', async () => {
    expect(await test.getCurrentAVL()).to.equals(
      (await token.balanceOf(oddBlockPool.address))
        .add(await token.balanceOf(usdcSupplyPool.address))
        .add(await token.balanceOf(conditionalPool.address))
    );
  });

  // Check totalAVL remains unchanged if stake withdrawn after deployment
  it("avlThreshold doesn't change post-deployment if unstaking tested contract", async () => {
    const avlThreshold = await test.avlThreshold();
    await oddBlockPool.connect(staker).withdrawStake();
    expect(await test.avlThreshold()).to.equals(avlThreshold);
  });

  // Check totalAVL remains unchanged if challenge withdrawn after deployment
  it("avlThreshold doesn't change post-deployment if un-challenging tested contract", async () => {
    const avlThreshold = await test.avlThreshold();
    await usdcSupplyPool.connect(challenger).unstakeAll(true);
    expect(await test.avlThreshold()).to.equals(avlThreshold);
  });

  // Check avlThreshold = sum of sub-pool balances in tested contracts / 100
  it('avlThreshold = sum of tested contract AVLs / 100', async () => {
    expect(await test.avlThreshold()).to.equals(
      (await token.balanceOf(oddBlockPool.address))
        .add(await token.balanceOf(usdcSupplyPool.address))
        .add(await token.balanceOf(conditionalPool.address))
        .div(10)
    );
  });

  // Check test still passes when AVL added to a tested contract (stake)
  it('still passes after staking tested contract', async () => {
    await oddBlockPool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
    expect(await test.checkTestPasses()).to.be.true;
  });

  // Check test still passes when AVL added to a tested contract (challenge)
  it('still passes after challenging tested contract', async () => {
    await oddBlockPool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
    await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
    await oddBlockPool.connect(challenger).confirmChallenge();
    expect(await test.checkTestPasses()).to.be.true;
  });

  // Check test still passes after withdrawing a small amount of stake from a tested contract
  it('still passes after unstaking small amount from tested contract', async () => {
    await oddBlockPool.connect(staker).withdrawStake();
    expect(await test.checkTestPasses()).to.be.true;
  });

  // Check test still passes after withdrawing a small amount of challenge from a tested contract
  it('still passes after un-challenging small amount from tested contract', async () => {
    await usdcSupplyPool.connect(challenger).unstakeAll(true);
    expect(await test.checkTestPasses()).to.be.true;
  });

  // Check test still passes if one of the tested contracts fails but total AVL high enough
  it('still passes if one sub-pool fails but total AVL high enough', async () => {
    await conditionalTest.setWillFail(true);
    await conditionalPool.connect(challenger).checkTest();
    expect(await test.checkTestPasses()).to.be.true;
  });

  // Check test still passes if one tested contract fails and challengers claim but total AVL still high enough
  it('still passes if one test fails and challenger claimed but total AVL high enough', async () => {
    await conditionalTest.setWillFail(true);
    await conditionalPool.connect(challenger).checkTest();
    await conditionalPool.connect(challenger).claim();
    expect(await test.checkTestPasses()).to.be.true;
  });

  // Check test fails if enough AVL withdrawn
  it('fails when enough is withdrawn from a tested contract', async () => {
    // unstakes >90% avl of a pool
    await oddBlockPool.connect(staker_2).unstakeAll(false);
    await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS + 1);
    await oddBlockPool.connect(staker_2).withdrawStake();

    expect(await test.checkTestPasses()).to.be.false;
  });
});
