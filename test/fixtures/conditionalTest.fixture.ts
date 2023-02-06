import { providers, Wallet } from 'ethers';

import { AnteERC20, AntePoolFactory, AnteConditionalTest, AnteConditionalTest__factory } from '../../typechain';

import { basicFixture } from './basic.fixture';
import * as constants from '../constants';

import hre from 'hardhat';
import { deployTestAndPool, evmMineBlocks, evmIncreaseTime, givePoolAllowance, giveTokens } from '../helpers';
const { waffle } = hre;

export interface ConditionalTestFixture {
  poolFactory: AntePoolFactory;
  conditionalTestDeployment: constants.TestPoolDeployment<AnteConditionalTest>;
  token: AnteERC20;
}

export async function conditionalTestFixture(w: Wallet[], p: providers.Web3Provider): Promise<ConditionalTestFixture> {
  const [deployer, author, staker, challenger, staker_2, challenger_2, _staker3, challenger_3] =
    waffle.provider.getWallets();
  const basicDeployment = await basicFixture(w, p);

  const token = basicDeployment.token;

  await giveTokens(deployer, token, [challenger_3]);

  const poolFactory = basicDeployment.poolFactory;

  const conditionalFactory = (await hre.ethers.getContractFactory(
    'AnteConditionalTest',
    staker
  )) as AnteConditionalTest__factory;
  const conditionalTestDeployment = await deployTestAndPool<AnteConditionalTest>(
    author,
    poolFactory,
    conditionalFactory,
    [],
    {
      tokenAddress: token.address,
    }
  );
  await givePoolAllowance(conditionalTestDeployment.pool, token, [
    staker,
    staker_2,
    challenger,
    challenger_2,
    challenger_3,
  ]);

  // stake 1 ETH on staker and a few ETH on challenger side
  const pool = conditionalTestDeployment.pool;
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

  return {
    poolFactory,
    conditionalTestDeployment,
    token: basicDeployment.token,
  };
}
