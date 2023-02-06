import { expect } from 'chai';

import { antePoolTestFixture, AntePoolTestFixture } from '../fixtures/antePoolTest.fixture';
import * as constants from '../constants';
import { evmSnapshot, evmRevert, evmIncreaseTime, evmSetNextBlockTimestamp } from '../helpers';

import hre from 'hardhat';
import {
  AnteERC20,
  AnteAuthorTest__factory,
  AntePoolTest__factory,
  AnteAuthorTest,
  AnteConditionalTest,
  AntePoolTest,
  AnteConditionalTest__factory,
  IAntePool,
  AnteOddBlockTest,
} from '../../typechain';
import { deployTestAndPool } from '../helpers';
const { waffle } = hre;
const { provider } = waffle;

describe('AntePoolTest', function () {
  const wallets = provider.getWallets();
  const [deployer, author, staker, challenger, staker_2, challenger_2] = wallets;

  let deployment: AntePoolTestFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let test: AntePoolTest;
  let conditionalTest: AnteConditionalTest;
  let conditionalTestPool: IAntePool;
  let oddBlockTestPool: IAntePool;
  let oddBlockTest: AnteOddBlockTest;
  let token: AnteERC20;

  before(async () => {
    deployment = await antePoolTestFixture(wallets, provider);
    globalSnapshotId = await evmSnapshot();
    snapshotId = await evmSnapshot();

    test = deployment.antePoolTestDeployment.test;
    token = deployment.token;
    conditionalTestPool = deployment.conditionalTestDeployment.pool;
    conditionalTest = deployment.conditionalTestDeployment.test;
    oddBlockTestPool = deployment.oddBlockDeployment.pool;
    oddBlockTest = deployment.oddBlockDeployment.test;
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
  });

  describe('constructor', () => {
    it('can initialize with provided test author, if overriden within the constructor', async () => {
      const anteAuthorTestFactory = (await hre.ethers.getContractFactory(
        'AnteAuthorTest',
        staker
      )) as AnteAuthorTest__factory;
      const { test: authorTest } = await deployTestAndPool<AnteAuthorTest>(
        staker,
        deployment.poolFactory,
        anteAuthorTestFactory,
        [staker_2.address],
        {
          tokenAddress: token.address,
        }
      );

      expect(await authorTest.testAuthor(), staker_2.address);
    });

    it('initializes the testAuthor with default value: msg.sender', async () => {
      expect(await conditionalTest.testAuthor(), staker.address);
    });
  });

  describe('setTestAuthor', () => {
    it('can set a new test author', async () => {
      const currentAuthor = await oddBlockTest.testAuthor();
      const newAuthor = staker;
      expect(currentAuthor).to.equal(author.address);
      await oddBlockTest.connect(author).setTestAuthor(newAuthor.address);

      expect(await oddBlockTest.testAuthor()).to.equal(newAuthor.address);
    });

    it('cannot be set by anyone different from current testAuthor', async () => {
      const currentAuthor = await oddBlockTest.testAuthor();
      const notTheAuthor = staker;

      expect(currentAuthor).to.equal(author.address);
      expect(currentAuthor).to.not.equal(notTheAuthor.address);

      await expect(oddBlockTest.connect(notTheAuthor).setTestAuthor(notTheAuthor.address)).to.be.revertedWith(
        'Only the current testAuthor can set a new test author'
      );
    });
  });

  it('antePoolTest checkTestPasses is true with array of ante pools with no stakers/challengers', async () => {
    const conditionalFactory = (await hre.ethers.getContractFactory(
      'AnteConditionalTest',
      staker
    )) as AnteConditionalTest__factory;
    const conditionalTestDeployment = await deployTestAndPool(staker, deployment.poolFactory, conditionalFactory, [], {
      tokenAddress: token.address,
    });

    const antePoolTestFactory = (await hre.ethers.getContractFactory('AntePoolTest', staker)) as AntePoolTest__factory;
    const antePoolTestDeployment = await deployTestAndPool(
      staker,
      deployment.poolFactory,
      antePoolTestFactory,
      [[conditionalTestDeployment.pool.address], token.address],
      {
        tokenAddress: token.address,
      }
    );

    expect(await antePoolTestDeployment.test.checkTestPasses()).to.be.true;
  });

  it('antePoolTest checkTestPasses is true with array of staked and challenged ante pools', async () => {
    await conditionalTestPool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
    await oddBlockTestPool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
    expect(await test.checkTestPasses()).to.be.true;
    await conditionalTestPool.connect(challenger).registerChallenge(constants.ONE_ETH);
    await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
    await conditionalTestPool.connect(challenger).confirmChallenge();
    await oddBlockTestPool.connect(challenger).registerChallenge(constants.ONE_ETH);
    await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
    await oddBlockTestPool.connect(challenger).confirmChallenge();
    expect(await test.checkTestPasses()).to.be.true;
  });

  it('antePoolTest checkTestPasses is true after removal of challenger from ante pool array', async () => {
    await conditionalTestPool.connect(challenger).unstakeAll(true);
    expect(await test.checkTestPasses()).to.be.true;
  });

  it('antePoolTest checkTestPasses is true after staker starts withdraw from ante pool array', async () => {
    await conditionalTestPool.connect(staker).unstakeAll(false);
    expect(await test.checkTestPasses()).to.be.true;
  });

  it('antePoolTest checkTestPasses is true after some decay has accrued in ante pool array', async () => {
    // Blocks have been mined, run checkTest to calculate decay
    await conditionalTestPool.updateDecay();
    await oddBlockTestPool.updateDecay();
    expect(await test.checkTestPasses()).to.be.true;
  });

  it('antePoolTest checkTestPasses is true after withdraw completes for staker', async () => {
    const withdrawTime = await oddBlockTestPool.getPendingWithdrawAllowedTime(staker_2.address);
    await evmSetNextBlockTimestamp(withdrawTime.toNumber() + 1);
    await oddBlockTestPool.connect(staker_2).withdrawStake();
    expect(await test.checkTestPasses()).to.be.true;
  });

  it('antePoolTest checkTestPasses is true after additional stakers with array of ante pools', async () => {
    await conditionalTestPool.connect(staker_2).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
    await oddBlockTestPool.connect(challenger_2).registerChallenge(constants.ONE_ETH.div(20));
    await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
    await oddBlockTestPool.connect(challenger_2).confirmChallenge();
    expect(await test.checkTestPasses()).to.be.true;
  });

  it('antePoolTest checkTestPasses is true with ante pool array with failed ante test', async () => {
    await conditionalTest.setWillFail(true);
    await conditionalTestPool.connect(challenger).checkTest();
    expect(await conditionalTestPool.pendingFailure()).to.be.true;
    expect(await test.checkTestPasses()).to.be.true;
  });

  it('antePoolTest checkTestPasses is true if challenger claims from failed ante test in ante pool array', async () => {
    await conditionalTest.setWillFail(true);
    await conditionalTestPool.connect(challenger).checkTest();
    expect(await conditionalTestPool.pendingFailure()).to.be.true;
    expect(await test.checkTestPasses()).to.be.true;

    // Have challenger claim with verifier bounty
    await conditionalTestPool.connect(challenger).claim();
    expect(await test.checkTestPasses()).to.be.true;

    // Have challenger_2 claim
    await conditionalTestPool.connect(challenger_2).claim();
    expect(await test.checkTestPasses()).to.be.true;
  });
});
