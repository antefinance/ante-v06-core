import { providers, Wallet } from 'ethers';

import { AntePoolFactory, AnteOOGDummyTest__factory, AnteOOGDummyTest } from '../../typechain';

import { basicFixture } from './basic.fixture';
import * as constants from '../constants';

import hre from 'hardhat';
import { deployTestAndPool, evmMineBlocks, evmIncreaseTime, givePoolAllowance } from '../helpers';

const { waffle } = hre;

export interface OOGTestFixture {
  poolFactory: AntePoolFactory;
  oogTestDeployment: constants.TestPoolDeployment<AnteOOGDummyTest>;
}

export async function oogTestFixture(w: Wallet[], p: providers.Web3Provider): Promise<OOGTestFixture> {
  const [staker, challenger] = waffle.provider.getWallets();
  const basicDeployment = await basicFixture(w, p);

  const poolFactory = basicDeployment.poolFactory;

  const revertingFactory = (await hre.ethers.getContractFactory(
    'AnteOOGDummyTest',
    staker
  )) as AnteOOGDummyTest__factory;
  const oogTestDeployment = await deployTestAndPool<AnteOOGDummyTest>(staker, poolFactory, revertingFactory, [], {
    tokenAddress: basicDeployment.token.address,
  });

  const pool = oogTestDeployment.pool;
  await givePoolAllowance(pool, basicDeployment.token, [staker, challenger]);

  // stake 10 ETH on staker and 1 ETH on challenger side
  await pool.connect(staker).stake(constants.ONE_ETH.mul(10), constants.MIN_STAKE_COMMITMENT);
  await pool.connect(challenger).registerChallenge(constants.ONE_ETH);
  await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
  await pool.connect(challenger).confirmChallenge();

  await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS + 1);
  await evmMineBlocks(12);

  return {
    poolFactory,
    oogTestDeployment,
  };
}
