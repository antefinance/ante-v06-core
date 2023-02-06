import { providers, Wallet } from 'ethers';

import { AnteERC20, AntePoolFactory, AnteRevertingTest, AnteRevertingTest__factory } from '../../typechain';

import { basicFixture } from './basic.fixture';
import * as constants from '../constants';

import hre from 'hardhat';
import { deployTestAndPool, evmMineBlocks, evmIncreaseTime, givePoolAllowance, giveTokens } from '../helpers';
const { waffle } = hre;
export interface RevertingTestFixture {
  poolFactory: AntePoolFactory;
  revertingTestDeployment: constants.TestPoolDeployment<AnteRevertingTest>;
  token: AnteERC20;
}

export async function revertingTestFixture(w: Wallet[], p: providers.Web3Provider): Promise<RevertingTestFixture> {
  const [deployer, _2, staker, challenger, staker_2, challenger_2, challenger_3] = waffle.provider.getWallets();
  const basicDeployment = await basicFixture(w, p);

  const token = basicDeployment.token;

  await giveTokens(deployer, token, [challenger_3]);

  const poolFactory = basicDeployment.poolFactory;

  const revertingFactory = (await hre.ethers.getContractFactory(
    'AnteRevertingTest',
    staker
  )) as AnteRevertingTest__factory;
  const revertingTestDeployment = await deployTestAndPool<AnteRevertingTest>(
    staker,
    poolFactory,
    revertingFactory,
    [],
    {
      tokenAddress: token.address,
    }
  );
  await givePoolAllowance(revertingTestDeployment.pool, token, [
    staker,
    staker_2,
    challenger,
    challenger_2,
    challenger_3,
  ]);

  // stake 1 ETH on staker and a few ETH on challenger side
  const pool = revertingTestDeployment.pool;
  await pool.connect(staker).stake(constants.ONE_ETH.mul(10), constants.MIN_STAKE_COMMITMENT);
  await pool.connect(staker_2).stake(constants.TWO_ETH.mul(10), constants.MIN_STAKE_COMMITMENT);

  await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
  await pool.connect(challenger_2).registerChallenge(constants.TWO_ETH.div(10));

  await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);

  await pool.connect(challenger).confirmChallenge();
  await pool.connect(challenger_2).confirmChallenge();

  await evmIncreaseTime(constants.MIN_STAKE_COMMITMENT);
  // intiate withdraw of some of stake
  await pool.connect(staker).unstakeAll(false);
  await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS);
  await evmMineBlocks(12);

  // ineligible challenger
  await pool.connect(challenger_3).registerChallenge(constants.ONE_ETH.div(100));
  await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
  await pool.connect(challenger_3).confirmChallenge();

  return {
    poolFactory,
    revertingTestDeployment,
    token: basicDeployment.token,
  };
}
