import { providers, Wallet } from 'ethers';

import {
  AntePoolFactory,
  AntePoolTest__factory,
  AnteStateTest__factory,
  AnteOddBlockTest,
  AntePoolTest,
  AnteERC20,
  AnteConditionalTest__factory,
  AnteConditionalTest,
  ReenteringContract,
} from '../../typechain';

import { basicFixture } from './basic.fixture';
import * as constants from '../constants';

import hre from 'hardhat';
import { deployTestAndPool, evmMineBlocks, evmIncreaseTime, givePoolAllowance, giveTokens } from '../helpers';
import { AnteStateTest } from '../../typechain/AnteStateTest';
import { AnteReenteringTest } from '../../typechain/AnteReenteringTest';
import { ReenteringContract__factory } from '../../typechain/factories/ReenteringContract__factory';
import { AnteReenteringTest__factory } from '../../typechain/factories/AnteReenteringTest__factory';
const { waffle } = hre;

export interface AntePoolTestFixture {
  poolFactory: AntePoolFactory;
  conditionalTestDeployment: constants.TestPoolDeployment<AnteConditionalTest>;
  oddBlockDeployment: constants.TestPoolDeployment<AnteOddBlockTest>;
  antePoolTestDeployment: constants.TestPoolDeployment<AntePoolTest>;
  stateTestDeployment: constants.TestPoolDeployment<AnteStateTest>;
  reenteringTestDeployment: constants.TestPoolDeployment<AnteReenteringTest>;
  reenteringContract: ReenteringContract;
  token: AnteERC20;
}

export async function antePoolTestFixture(w: Wallet[], p: providers.Web3Provider): Promise<AntePoolTestFixture> {
  const [deployer, author, staker, challenger, staker_2, challenger_2, challenger_3] = waffle.provider.getWallets();
  const basicDeployment = await basicFixture(w, p);

  const poolFactory = basicDeployment.poolFactory;
  const oddBlockDeployment = basicDeployment.oddBlockDeployment;
  const oddBlockTestPool = oddBlockDeployment.pool;
  const token = basicDeployment.token;

  await giveTokens(deployer, token, [challenger_3]);

  const conditionalFactory = (await hre.ethers.getContractFactory(
    'AnteConditionalTest',
    staker
  )) as AnteConditionalTest__factory;
  const conditionalTestDeployment = await deployTestAndPool<AnteConditionalTest>(
    staker,
    poolFactory,
    conditionalFactory,
    [],
    {
      tokenAddress: token.address,
    }
  );
  const conditionalTestPool = conditionalTestDeployment.pool;

  await givePoolAllowance(conditionalTestPool, token, [staker, challenger, staker_2, challenger_2, challenger_3]);

  const antePoolTestFactory = (await hre.ethers.getContractFactory('AntePoolTest', staker)) as AntePoolTest__factory;
  const antePoolTestDeployment = await deployTestAndPool<AntePoolTest>(
    staker,
    poolFactory,
    antePoolTestFactory,
    [[conditionalTestDeployment.pool.address, oddBlockDeployment.pool.address], token.address],
    {
      tokenAddress: token.address,
    }
  );
  await givePoolAllowance(antePoolTestDeployment.pool, token, [
    staker,
    challenger,
    staker_2,
    challenger_2,
    challenger_3,
  ]);

  const stateTestFactory = (await hre.ethers.getContractFactory('AnteStateTest', staker)) as AnteStateTest__factory;
  const stateTestDeployment = await deployTestAndPool<AnteStateTest>(staker, poolFactory, stateTestFactory, [], {
    tokenAddress: token.address,
  });

  await givePoolAllowance(stateTestDeployment.pool, token, [staker, challenger, staker_2, challenger_2, challenger_3]);

  const reenteringContractFactory = (await hre.ethers.getContractFactory(
    'ReenteringContract',
    staker
  )) as ReenteringContract__factory;
  const reenteringContract = await reenteringContractFactory.deploy();
  await reenteringContract.deployed();

  await token.connect(deployer).transfer(reenteringContract.address, constants.ONE_ETH.mul(100));

  const reenteringTestFactory = (await hre.ethers.getContractFactory(
    'AnteReenteringTest',
    staker
  )) as AnteReenteringTest__factory;
  const reenteringTestDeployment = await deployTestAndPool<AnteReenteringTest>(
    staker,
    poolFactory,
    reenteringTestFactory,
    [reenteringContract.address],
    { tokenAddress: token.address }
  );

  await givePoolAllowance(reenteringTestDeployment.pool, token, [staker, challenger, staker_2, challenger_2]);

  await reenteringTestDeployment.pool.connect(staker).stake(constants.ONE_ETH.mul(10), constants.MIN_STAKE_COMMITMENT);
  await reenteringTestDeployment.pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
  await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);

  await oddBlockTestPool.connect(staker).stake(constants.ONE_ETH.mul(10), constants.MIN_STAKE_COMMITMENT);
  await oddBlockTestPool.connect(staker_2).stake(constants.ONE_ETH.mul(10), constants.MIN_STAKE_COMMITMENT);
  await conditionalTestPool.connect(staker).stake(constants.ONE_ETH.mul(20), constants.MIN_STAKE_COMMITMENT);
  await stateTestDeployment.pool.connect(staker).stake(constants.ONE_ETH.mul(20), constants.MIN_STAKE_COMMITMENT);

  await oddBlockTestPool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
  await conditionalTestPool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
  await conditionalTestPool.connect(challenger_2).registerChallenge(constants.ONE_ETH.div(10));
  await stateTestDeployment.pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));

  await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);

  await oddBlockTestPool.connect(challenger).confirmChallenge();
  await conditionalTestPool.connect(challenger).confirmChallenge();
  await conditionalTestPool.connect(challenger_2).confirmChallenge();
  await stateTestDeployment.pool.connect(challenger).confirmChallenge();

  await evmIncreaseTime(constants.MIN_STAKE_COMMITMENT);
  await oddBlockTestPool.connect(staker_2).unstakeAll(false);

  // Mine the minimum required blocks
  await evmMineBlocks(12);

  return {
    poolFactory,
    conditionalTestDeployment,
    oddBlockDeployment,
    antePoolTestDeployment,
    stateTestDeployment,
    reenteringTestDeployment,
    reenteringContract,
    token,
  };
}
