import { AntePoolFactory, AnteRevertingTest, IAntePool } from '../../typechain';
import { BasicFixture } from '../fixtures/basic.fixture';
import {
  Action,
  AdvanceBlocksActionParams,
  AdvanceTimeActionParams,
  CheckActionParams,
  CheckActionType,
  CHECK_ACTION_TYPE,
  ClaimActionParams,
  ConfirmChallengeActionParams,
  DeployActionParams,
  RegisterChallengeActionParams,
  StakeActionParams,
  UnstakeActionParams,
  UnstakeChallengeActionParams,
} from './f1_scenarios.types';
import { deployPool, evmMineBlocks, evmSetNextBlockTimestamp, blockTimestamp } from '../helpers';
import AntePoolFactoryArtifact from '../../artifacts/contracts/AntePoolFactory.sol/AntePoolFactory.json';
import AnteRevertingTestArtifact from '../../artifacts/contracts/mock/AnteRevertingTest.sol/AnteRevertingTest.json';

import hre from 'hardhat';
import { MIN_STAKE_COMMITMENT, ONE_DAY_IN_SECONDS, ONE_ETH } from '../constants';
import { Wallet } from 'ethers';
import { expect } from 'chai';
const { waffle } = hre;
const { provider, deployContract } = waffle;

export const DEPLOYMENT_HANDLERS = {
  DEPLOY: async (deployment: BasicFixture, action: Action<DeployActionParams>): Promise<IAntePool> => {
    const [deployer, author, staker, challenger, staker2, challenger2] = provider.getWallets();

    // Deploy a new factory for every new pool in order to avoid duplicate pool configs
    const poolFactory = (await deployContract(deployer, AntePoolFactoryArtifact, [
      deployment.controller.address,
    ])) as AntePoolFactory;
    // Deploy a test with predictable outcome
    const test = (await deployContract(deployer, AnteRevertingTestArtifact)) as AnteRevertingTest;

    const pool = await deployPool(poolFactory, test.address, {
      tokenAddress: deployment.token.address,
      ...action.params,
    });

    // For convenience, allow the pool to transfer tokens on behalf of a few wallets
    await deployment.token.connect(deployer).approve(pool.address, ONE_ETH.mul(100));
    await deployment.token.connect(author).approve(pool.address, ONE_ETH.mul(100));
    await deployment.token.connect(staker).approve(pool.address, ONE_ETH.mul(100));
    await deployment.token.connect(staker2).approve(pool.address, ONE_ETH.mul(100));
    await deployment.token.connect(challenger).approve(pool.address, ONE_ETH.mul(100));
    await deployment.token.connect(challenger2).approve(pool.address, ONE_ETH.mul(100));

    return pool;
  },
};

export const SIGNED_ACTIONS_HANDLERS = {
  STAKE: async (pool: IAntePool, wallets: Wallet[], action: Action<StakeActionParams>): Promise<void> => {
    const { commitTime, amount, signer: signerIndex } = action.params;
    const signer = wallets[Number(signerIndex)];

    if (!amount) {
      throw new Error('Invalid arguments');
    }

    const amountBN = hre.ethers.utils.parseEther(amount);

    await expect(pool.connect(signer).stake(amountBN, commitTime ?? MIN_STAKE_COMMITMENT))
      .to.emit(pool, 'Stake')
      .withArgs(signer.address, amountBN, commitTime);
  },
  REGISTER_CHALLENGE: async (
    pool: IAntePool,
    wallets: Wallet[],
    action: Action<RegisterChallengeActionParams>
  ): Promise<void> => {
    const { signer: signerIndex, amount } = action.params;
    const signer = wallets[Number(signerIndex)];

    if (!amount) {
      throw new Error('Invalid arguments');
    }

    const amountBN = hre.ethers.utils.parseEther(amount);

    await expect(pool.connect(signer).registerChallenge(amountBN))
      .to.emit(pool, 'RegisterChallenge')
      .withArgs(signer.address, amountBN);
  },
  CONFIRM_CHALLENGE: async (
    pool: IAntePool,
    wallets: Wallet[],
    action: Action<ConfirmChallengeActionParams>
  ): Promise<void> => {
    const { signer: signerIndex } = action.params;
    const signer = wallets[Number(signerIndex)];

    // Check only if the event was emitted otherwise
    // the implementation complexity increases
    await expect(pool.connect(signer).confirmChallenge()).to.emit(pool, 'ConfirmChallenge');
  },
  UNSTAKE: async (pool: IAntePool, wallets: Wallet[], action: Action<UnstakeActionParams>): Promise<void> => {
    const { signer: signerIndex, amount, isChallenger } = action.params;
    const signer = wallets[Number(signerIndex)];

    if (!amount) {
      throw new Error('Invalid arguments');
    }

    const amountBN = hre.ethers.utils.parseEther(amount);

    // Unstake staker by default - if no value is provided
    const shouldUnstakeChallenger =
      isChallenger === undefined
        ? false
        : ['true', '1'].includes(isChallenger)
        ? true
        : ['false', '0'].includes(isChallenger)
        ? false
        : Boolean(isChallenger);

    await expect(pool.connect(signer).unstake(amountBN, shouldUnstakeChallenger))
      .to.emit(pool, 'Unstake')
      .withArgs(signer.address, amountBN, shouldUnstakeChallenger);
  },
  UNSTAKE_CHALLENGE: async (
    pool: IAntePool,
    wallets: Wallet[],
    action: Action<UnstakeChallengeActionParams>
  ): Promise<void> => {
    return await SIGNED_ACTIONS_HANDLERS.UNSTAKE(pool, wallets, {
      ...action,
      params: { ...action.params, isChallenger: 'true' },
    });
  },
  CLAIM: async (pool: IAntePool, wallets: Wallet[], action: Action<ClaimActionParams>): Promise<void> => {
    const { signer: signerIndex } = action.params;
    const signer = wallets[Number(signerIndex)];

    await expect(pool.connect(signer).claim()).to.emit(pool, 'ClaimPaid');
  },
  CLAIM_REWARD: async (pool: IAntePool, wallets: Wallet[], action: Action<ClaimActionParams>): Promise<void> => {
    const { signer: signerIndex } = action.params;
    const signer = wallets[Number(signerIndex)];

    await expect(pool.connect(signer).claim()).to.emit(pool, 'RewardPaid');
  },
};

export const CHAIN_ACTIONS_HANDLERS = {
  ADVANCE_BLOCKS: async (action: Action<AdvanceBlocksActionParams>): Promise<void> => {
    const { numBlocks } = action.params;

    await evmMineBlocks(numBlocks ? Number(numBlocks) : 1);
  },
  ADVANCE_TIME: async (action: Action<AdvanceTimeActionParams>): Promise<void> => {
    const { seconds, days } = action.params;
    let numSeconds = ONE_DAY_IN_SECONDS;
    if (seconds) {
      numSeconds = Number(seconds);
    } else if (days) {
      numSeconds = 60 * 60 * 24 * Number(days);
    }

    await evmSetNextBlockTimestamp((await blockTimestamp()) + numSeconds);
  },
};

export const CHECK_HANDLERS = {
  balance: async (
    checkedField: string,
    expectedValue: string,
    _pool: IAntePool,
    deployment: BasicFixture
  ): Promise<void> => {
    const wallets = provider.getWallets();

    const [, signerIndex] = checkedField.split('_');
    if (signerIndex.length !== 1) {
      throw new Error(`Invalid CHECK balance parameter: ${checkedField}. E.g. balance_0`);
    }
    const value = hre.ethers.utils.parseEther(expectedValue);

    expect(await deployment.token.balanceOf(wallets[Number(signerIndex)].address)).to.be.equal(value);
  },
  storedBalance: async (
    checkedField: string,
    expectedValue: string,
    pool: IAntePool,
    _deployment: BasicFixture
  ): Promise<void> => {
    const wallets = provider.getWallets();

    const [, signer] = checkedField.split('_');
    if (signer.length !== 2) {
      throw new Error(
        `Invalid CHECK storedBalance parameter: ${checkedField}. E.g. storedBalance_s0, storedBalance_c0`
      );
    }
    const isChallenger = signer[0] === 'c';
    const signerIndex = signer[1];
    const value = hre.ethers.utils.parseEther(expectedValue);

    expect(await pool.getStoredBalance(wallets[Number(signerIndex)].address, isChallenger)).to.be.equal(value);
  },
  totalShares: async (
    _checkedField: string,
    expectedValue: string,
    pool: IAntePool,
    _deployment: BasicFixture
  ): Promise<void> => {
    const value = hre.ethers.utils.parseEther(expectedValue);

    expect(await pool.getTotalChallengerEligibleBalance()).to.be.equal(value);
  },
};

export const META_ACTIONS_HANDLERS = {
  CHECK: async (deployment: BasicFixture, pool: IAntePool, action: Action<CheckActionParams>): Promise<void> => {
    for (const key of Object.keys(action.params)) {
      // First part of the string (before _) represents the checked parameter
      const [field] = key.split('_');

      if (!CHECK_ACTION_TYPE.hasOwnProperty(field)) {
        throw new Error(`Unsupported check field: ${field}`);
      }

      await CHECK_HANDLERS[field as CheckActionType](key, action.params[key], pool, deployment);
    }
  },
};
