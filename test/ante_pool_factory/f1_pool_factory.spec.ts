import { basicFixture, BasicFixture } from '../fixtures/basic.fixture';
import {
  evmSnapshot,
  evmRevert,
  getPoolConfigHash,
  generateSignerFromAddress,
  evmMineBlocks,
  givePoolAllowance,
  deployPool,
  evmIncreaseTime,
} from '../helpers';
import { TOKENS } from '../constants';
import hre from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider, deployContract } = waffle;

import {
  AntePoolFactory,
  AnteInvalidTest__factory,
  AnteAlwaysFailTest__factory,
  AnteAlwaysPassTest__factory,
  AnteERC20,
  AntePoolFactory__factory,
  IAntePool,
  AnteConditionalTest,
  AnteConditionalTest__factory,
  AntePoolMaliciousLogic,
} from '../../typechain';

import { expect } from 'chai';
import { BigNumber, Signer } from 'ethers';
import * as constants from '../constants';
import { AnteMaliciousStakeTest__factory } from '../../typechain/factories/AnteMaliciousStakeTest__factory';
import AntePoolMaliciousLogicArtifact from '../../artifacts/contracts/mock/AntePoolMaliciousLogic.sol/AntePoolMaliciousLogic.json';
import { deployTestAndPool } from '../helpers';

describe('Ante Pool Factory', function () {
  const wallets = provider.getWallets();
  const [deployer, staker, challenger] = wallets;

  let deployment: BasicFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let deploymentPoolFactory: AntePoolFactory;
  let poolFactory: AntePoolFactory;
  let token: AnteERC20;
  let minChallengerStake: BigNumber;
  let conditionalTestDeployment: constants.TestPoolDeployment<AnteConditionalTest>;

  before(async () => {
    deployment = await loadFixture(basicFixture);
    globalSnapshotId = await evmSnapshot();
    snapshotId = await evmSnapshot();

    token = deployment.token;
    deploymentPoolFactory = deployment.poolFactory;
    minChallengerStake = await deployment.controller.getTokenMinimum(token.address);
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
    await deployment.oddBlockDeployment.test.setWillTest(false);

    const factory = (await hre.ethers.getContractFactory('AntePoolFactory', deployer)) as AntePoolFactory__factory;
    poolFactory = (await factory.deploy(deployment.controller.address)) as AntePoolFactory;
    await poolFactory.deployed();
  });

  describe('createPool', () => {
    it('should revert if trying to create a pool from an invalid ante test', async () => {
      const factory = (await hre.ethers.getContractFactory('AnteInvalidTest', deployer)) as AnteInvalidTest__factory;

      const testContract = await factory.deploy();
      await testContract.deployed();

      await expect(poolFactory.createPool(testContract.address, token.address, 10, 10, 10)).to.be.revertedWith(
        'ANTE: AnteTest does not implement checkTestPasses or test fails'
      );
    });

    it('should revert if trying to create a pool from a currently failing ante test', async () => {
      const factory = (await hre.ethers.getContractFactory(
        'AnteAlwaysFailTest',
        deployer
      )) as AnteAlwaysFailTest__factory;

      const testContract = await factory.deploy();
      await testContract.deployed();

      await expect(poolFactory.createPool(testContract.address, token.address, 10, 10, 10)).to.be.revertedWith(
        'ANTE: AnteTest does not implement checkTestPasses or test fails'
      );
    });

    it('should revert if trying to create a pool from a previously failed ante test', async () => {
      const factory = (await hre.ethers.getContractFactory(
        'AnteConditionalTest',
        deployer
      )) as AnteConditionalTest__factory;

      const { pool, test } = await deployTestAndPool<AnteConditionalTest>(deployer, poolFactory, factory, [], {
        tokenAddress: token.address,
      });
      await givePoolAllowance(pool, token, [staker, challenger]);

      await pool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
      await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await pool.connect(challenger).confirmChallenge();

      await evmMineBlocks(12);

      await test.setWillFail(true);

      await pool.connect(challenger).checkTest();

      await test.setWillFail(false);

      expect(await pool.pendingFailure()).to.be.true;
      await expect(poolFactory.createPool(test.address, token.address, 10, 10, 0)).to.be.revertedWith(
        'ANTE: Test has previously failed'
      );
    });

    it('should revert if trying to create a duplicate pool for an ante test', async () => {
      const { test } = deployment.oddBlockDeployment;

      await poolFactory.createPool(test.address, token.address, 10, 10, 10);

      await expect(poolFactory.createPool(test.address, token.address, 10, 10, 10)).to.be.revertedWith(
        'ANTE: Pool with the same config already exists'
      );
    });

    it('should revert if provided token is not allowed by controller', async () => {
      const { test } = deployment.oddBlockDeployment;
      await expect(poolFactory.createPool(test.address, TOKENS.WBTC, 10, 10, 10)).to.be.revertedWith(
        'ANTE: Token not allowed'
      );
    });

    it('should revert if max number of pools per test reached', async () => {
      const { test } = deployment.oddBlockDeployment;

      // Assuming we're not going to be allowing more than 2^64 pools per test.
      const max = Number(await deploymentPoolFactory.MAX_POOLS_PER_TEST());

      for (let i = 0; i < max - 1; i++) {
        await deploymentPoolFactory.createPool(test.address, token.address, 10, 10, i);
      }

      await expect(deploymentPoolFactory.createPool(test.address, token.address, 5, 5, 10)).to.be.revertedWith(
        'ANTE: Max pools per test reached'
      );
    });

    it('should revert if pool with same configs already exists', async () => {
      const { test } = deployment.oddBlockDeployment;

      await poolFactory.createPool(test.address, token.address, 10, 10, 10);

      await expect(poolFactory.createPool(test.address, token.address, 10, 10, 10)).to.be.revertedWith(
        'ANTE: Pool with the same config already exists'
      );
    });

    it('updates allPools, poolsByTest and poolByConfig correctly', async () => {
      const { pool, test } = deployment.oddBlockDeployment;

      // this is first test/pool created
      expect(await deploymentPoolFactory.allPools(0)).to.equal(pool.address);
      expect(await deploymentPoolFactory.getPoolsByTest(test.address)).to.deep.equal([pool.address]);

      const hash = await getPoolConfigHash(pool);
      expect(await deploymentPoolFactory.poolByConfig(hash)).to.deep.equal(pool.address);
    });

    it('should emit AntePoolCreated event on pool creation', async () => {
      const payoutRatio = 10;
      const decayRate = 5;
      const authorRewardRate = 10;

      const factory = (await hre.ethers.getContractFactory(
        'AnteAlwaysPassTest',
        deployer
      )) as AnteAlwaysPassTest__factory;

      const testContract = await factory.deploy();
      await testContract.deployed();

      const tx = await poolFactory.createPool(
        testContract.address,
        token.address,
        payoutRatio,
        decayRate,
        authorRewardRate
      );

      const receipt = await tx.wait();
      const createdEvent = receipt.events?.find((event) => event.event === 'AntePoolCreated');

      expect(createdEvent).to.not.be.undefined;
      expect(createdEvent?.args?.length).to.equal(8);
      expect(createdEvent?.args?.[0]).to.equal(testContract.address);
      expect(createdEvent?.args?.[1]).to.equal(token.address);
      expect(createdEvent?.args?.[2]).to.equal(minChallengerStake);
      expect(createdEvent?.args?.[3]).to.equal(payoutRatio);
      expect(createdEvent?.args?.[4]).to.equal(decayRate);
      expect(createdEvent?.args?.[5]).to.equal(authorRewardRate);
      expect(createdEvent?.args?.[7]).to.equal(deployer.address);
    });

    it('initializes all fields before checking that test passes', async () => {
      const factory = (await hre.ethers.getContractFactory(
        'AnteMaliciousStakeTest',
        deployer
      )) as AnteMaliciousStakeTest__factory;

      const testContract = await factory.deploy();
      await testContract.deployed();

      await expect(
        poolFactory.createPool(
          testContract.address,
          token.address,
          constants.CHALLENGER_PAYOUT_RATIO,
          constants.ANNUAL_DECAY_RATE,
          constants.AUTHOR_REWARD_RATE
        )
      ).to.be.revertedWith('ANTE: Supporter must stake more than minSupporterStake');
    });
  });

  describe('checkTestWithState', () => {
    beforeEach(async () => {
      const conditionalFactory = (await hre.ethers.getContractFactory(
        'AnteConditionalTest',
        deployer
      )) as AnteConditionalTest__factory;

      conditionalTestDeployment = await deployTestAndPool<AnteConditionalTest>(
        deployer,
        poolFactory,
        conditionalFactory,
        [],
        {
          tokenAddress: token.address,
        }
      );
    });

    it('reverts if not called by a pool', async () => {
      const { pool } = deployment.oddBlockDeployment;

      await expect(
        deploymentPoolFactory.checkTestWithState([], deployer.address, await getPoolConfigHash(pool))
      ).to.be.revertedWith('ANTE: Must be called by a pool');
    });

    it('should update to failure state of all pools associated with provided test', async () => {
      const pools = [];

      const { test } = conditionalTestDeployment;

      for (let i = 1; i < 6; i++) {
        const tx = await poolFactory.createPool(
          test.address,
          token.address,
          i + constants.MIN_CHALLENGER_PAYOUT_RATIO,
          i + constants.MIN_ANNUAL_DECAY_RATE,
          i
        );
        const receipt = await tx.wait();
        const createdEvent = receipt.events?.find((event) => event.event === 'AntePoolCreated');
        // Get the AntePool proxy address from emitted event
        const poolAddress = createdEvent?.args?.[6];
        // Bind the AntePool interface to AntePool proxy address
        const contract = <IAntePool>await hre.ethers.getContractAt('AntePoolLogic', poolAddress);

        expect(await contract.pendingFailure()).to.be.equal(false);
        pools.push(contract);
      }

      const testedPool = pools[0];

      await givePoolAllowance(testedPool, token, [staker, challenger]);
      await test.setWillFail(true);

      await testedPool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
      await testedPool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await testedPool.connect(challenger).confirmChallenge();
      await evmMineBlocks(12);

      const poolSigner = await generateSignerFromAddress(testedPool.address);

      await poolFactory
        .connect(poolSigner as Signer)
        .checkTestWithState([], challenger.address, await getPoolConfigHash(testedPool));

      for (const pool of pools) {
        expect(await pool.pendingFailure()).to.be.equal(true);
      }
    });

    it('successfully updates failure state regardless malicious pool', async () => {
      const { test, pool } = conditionalTestDeployment;

      await givePoolAllowance(pool, token, [staker, challenger]);
      await test.setWillFail(true);

      await pool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
      await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await pool.connect(challenger).confirmChallenge();
      await evmMineBlocks(12);

      const maliciousLogic = (await deployContract(deployer, AntePoolMaliciousLogicArtifact)) as AntePoolMaliciousLogic;
      await deployment.controller.connect(deployer).setPoolLogicAddr(maliciousLogic.address);

      const maliciousPool = await deployPool(poolFactory, test.address, {
        tokenAddress: token.address,
        decayRate: 9,
      });

      await test.setWillFail(true);

      expect(await pool.pendingFailure()).to.be.false;

      expect(await poolFactory.getNumPoolsByTest(test.address)).to.be.equal(2);
      expect(await poolFactory.poolsByTest(test.address, 1)).to.be.equal(maliciousPool.address);

      await expect(pool.connect(challenger).checkTest()).to.emit(poolFactory, 'PoolFailureReverted');

      expect(await pool.pendingFailure()).to.be.true;
    });
  });

  describe('getNumPoolsByTest', () => {
    it('should return the number of pools for a test', async () => {
      const { test } = deployment.oddBlockDeployment;

      const poolsCount = 5;

      for (let i = 0; i < poolsCount; i++) {
        await poolFactory.createPool(test.address, token.address, 10, 10, i);
      }

      expect(await poolFactory.getNumPoolsByTest(test.address)).to.be.equal(poolsCount);
    });

    it('should return 0 if there are no pools for the specified address', async () => {
      const { test } = deployment.oddBlockDeployment;
      expect(await poolFactory.getNumPoolsByTest(test.address)).to.be.equal(0);
    });
  });

  describe('numPools', () => {
    it('Can read numPools correctly', async () => {
      expect(await deploymentPoolFactory.numPools()).to.be.equal(1);
    });
  });
});
