import { basicFixture, BasicFixture } from '../fixtures/basic.fixture';
import { evmSnapshot, evmRevert, generateSignerFromAddress } from '../helpers';
import AntePoolArtifact from '../../artifacts/contracts/AntePool.sol/AntePool.json';
import AntePoolLogicArtifact from '../../artifacts/contracts/AntePoolLogic.sol/AntePoolLogic.json';
import AnteAlwaysFailTest from '../../artifacts/contracts/mock/AnteAlwaysFailTest.sol/AnteAlwaysFailTest.json';
import AnteAlwaysPassTest from '../../artifacts/contracts/mock/AnteAlwaysPassTest.sol/AnteAlwaysPassTest.json';
import AnteInvalidTest from '../../artifacts/contracts/mock/AnteInvalidTest.sol/AnteInvalidTest.json';

import hre from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider, deployContract } = waffle;

import { expect } from 'chai';
import { AnteERC20, AntePool, AntePoolFactory, AntePoolFactoryController, AntePoolLogic } from '../../typechain';
import {
  ANNUAL_DECAY_RATE,
  AUTHOR_REWARD_RATE,
  CHALLENGER_PAYOUT_RATIO,
  MIN_STAKE_COMMITMENT,
  ONE_ETH,
} from '../constants';
import { BigNumber, Signer } from 'ethers';

describe('Initializing AntePool', () => {
  const wallets = provider.getWallets();
  const [deployer, eoa] = wallets;

  let deployment: BasicFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let poolFactory: AntePoolFactory;
  let controller: AntePoolFactoryController;
  let poolFactorySigner: Signer;
  let uninitializedPool: AntePoolLogic;
  let token: AnteERC20;
  let logic: AntePoolLogic;
  let tokenMin: BigNumber;

  before(async () => {
    deployment = await loadFixture(basicFixture);
    token = deployment.token;
    poolFactory = deployment.poolFactory;
    controller = deployment.controller;

    tokenMin = await controller.getTokenMinimum(token.address);
    poolFactorySigner = await generateSignerFromAddress(poolFactory.address);
    globalSnapshotId = await evmSnapshot();
    snapshotId = await evmSnapshot();
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();

    logic = (await deployContract(deployer, AntePoolLogicArtifact)) as AntePoolLogic;
    // cannot create an uninitialized pool through pool factory
    const proxy = (await deployContract(deployer, AntePoolArtifact, [logic.address])) as AntePool;
    uninitializedPool = <AntePoolLogic>await hre.ethers.getContractAt('AntePoolLogic', proxy.address);
  });

  describe('AntePool Proxy', () => {
    it('can initialize with a challenger payout ratio', async () => {
      const test = await deployContract(deployer, AnteAlwaysPassTest);
      await uninitializedPool
        .connect(poolFactorySigner)
        .initialize(
          test.address,
          token.address,
          tokenMin,
          ANNUAL_DECAY_RATE,
          CHALLENGER_PAYOUT_RATIO,
          AUTHOR_REWARD_RATE
        );
      expect(await uninitializedPool.challengerPayoutRatio()).to.equal(CHALLENGER_PAYOUT_RATIO);
    });

    it('cannot be initialized by EOA', async () => {
      await expect(
        uninitializedPool
          .connect(eoa)
          .initialize(
            deployment.oddBlockDeployment.test.address,
            token.address,
            tokenMin,
            ANNUAL_DECAY_RATE,
            CHALLENGER_PAYOUT_RATIO,
            AUTHOR_REWARD_RATE
          )
      ).to.be.revertedWith('ANTE: Factory must be a contract');
    });

    it('can only be initialized once', async () => {
      const test = await deployContract(deployer, AnteAlwaysPassTest);
      await uninitializedPool
        .connect(poolFactorySigner)
        .initialize(
          test.address,
          token.address,
          tokenMin,
          ANNUAL_DECAY_RATE,
          CHALLENGER_PAYOUT_RATIO,
          AUTHOR_REWARD_RATE
        );

      await expect(
        uninitializedPool
          .connect(poolFactorySigner)
          .initialize(
            test.address,
            token.address,
            tokenMin,
            ANNUAL_DECAY_RATE,
            CHALLENGER_PAYOUT_RATIO,
            AUTHOR_REWARD_RATE
          )
      ).to.be.revertedWith('ANTE: Pool already initialized');
    });

    it('can initialize with a decay rate', async () => {
      const decayRate = 17;
      const test = await deployContract(deployer, AnteAlwaysPassTest);
      await uninitializedPool
        .connect(poolFactorySigner)
        .initialize(
          test.address,
          deployment.token.address,
          tokenMin,
          decayRate,
          CHALLENGER_PAYOUT_RATIO,
          AUTHOR_REWARD_RATE
        );
      expect(await uninitializedPool.decayRate()).to.equal(decayRate);
    });

    it('automatically sets minSupporterStake based on minChallenger and challengerPayoutRatio', async () => {
      const decayRate = 17;
      const test = await deployContract(deployer, AnteAlwaysPassTest);
      const minChallengerStake = await controller.getTokenMinimum(deployment.token.address);
      await uninitializedPool
        .connect(poolFactorySigner)
        .initialize(
          test.address,
          deployment.token.address,
          tokenMin,
          decayRate,
          CHALLENGER_PAYOUT_RATIO,
          AUTHOR_REWARD_RATE
        );
      expect(await uninitializedPool.minSupporterStake()).to.equal(minChallengerStake.mul(CHALLENGER_PAYOUT_RATIO));
    });
  });

  describe('AntePoolLogic', () => {
    it('reverts if provided AnteTest is EOA', async () => {
      await expect(
        poolFactory.createPool(
          eoa.address,
          token.address,
          CHALLENGER_PAYOUT_RATIO,
          ANNUAL_DECAY_RATE,
          AUTHOR_REWARD_RATE
        )
      ).to.be.revertedWith('ANTE: AnteTest must be a smart contract');
    });

    it('cannot be initialized with a failing AnteTest', async () => {
      const alwaysFailTest = await deployContract(deployer, AnteAlwaysFailTest);

      await expect(
        poolFactory.createPool(
          alwaysFailTest.address,
          token.address,
          CHALLENGER_PAYOUT_RATIO,
          ANNUAL_DECAY_RATE,
          AUTHOR_REWARD_RATE
        )
      ).to.be.revertedWith('ANTE: AnteTest does not implement checkTestPasses or test fails');
    });

    it("cannot be initialized with test contract that doesn't implement checkTestPasses", async () => {
      const invalidTest = await deployContract(deployer, AnteInvalidTest);

      await expect(
        poolFactory.createPool(
          invalidTest.address,
          token.address,
          CHALLENGER_PAYOUT_RATIO,
          ANNUAL_DECAY_RATE,
          AUTHOR_REWARD_RATE
        )
      ).to.be.revertedWith('ANTE: AnteTest does not implement checkTestPasses or test fails');
    });

    it('cannot stake in logic contract', async () => {
      await expect(logic.stake(ONE_ETH, MIN_STAKE_COMMITMENT)).to.be.revertedWith(
        'ANTE: Only delegate calls are allowed.'
      );
    });

    it('cannot challenge in logic contract', async () => {
      await expect(logic.registerChallenge(ONE_ETH)).to.be.revertedWith('ANTE: Only delegate calls are allowed.');
    });

    it('cannot be initialized by non-delegate call', async () => {
      const test = await deployContract(deployer, AnteAlwaysPassTest);

      await expect(
        logic.initialize(
          test.address,
          token.address,
          tokenMin,
          ANNUAL_DECAY_RATE,
          CHALLENGER_PAYOUT_RATIO,
          AUTHOR_REWARD_RATE
        )
      ).to.be.revertedWith('ANTE: Pool already initialized');
    });

    it('reverts all actions if user tries to interact with the logic contract. Actions: stake/registerChallenge/confirmChallenge/unstake/withdrawStake/cancelPendingWithdraw', async () => {
      const actions = [
        logic.connect(eoa).stake(ONE_ETH, MIN_STAKE_COMMITMENT),
        logic.connect(eoa).registerChallenge(ONE_ETH.div(10)),
        logic.connect(eoa).confirmChallenge(),
        logic.connect(eoa).unstakeAll(true),
        logic.connect(eoa).unstake(ONE_ETH, false),
        logic.connect(eoa).unstake(ONE_ETH, true),
        logic.connect(eoa).cancelPendingWithdraw(),
      ];

      for (const action of actions) {
        await expect(action).to.be.revertedWith('ANTE: Test already failed');
      }

      await expect(logic.connect(eoa).unstakeAll(false)).to.be.revertedWith('ANTE: Nothing to unstake');
      await expect(logic.connect(eoa).withdrawStake()).to.be.revertedWith('ANTE: Nothing to withdraw');
    });
  });
});
