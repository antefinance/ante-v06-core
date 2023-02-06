import { providers, Wallet } from 'ethers';

import { BasicFixture, basicFixture } from './basic.fixture';
import * as constants from '../constants';

import hre from 'hardhat';
import { evmIncreaseTime } from '../helpers';
const { waffle } = hre;
const { loadFixture } = waffle;

export async function oneSupportChallengeFixture(w: Wallet[], p: providers.Web3Provider): Promise<BasicFixture> {
  const [_1, _2, staker, challenger] = waffle.provider.getWallets();
  const basicDeployment = await loadFixture(basicFixture);

  // stake 1 ETH on staker and challenger side
  const pool = basicDeployment.oddBlockDeployment.pool;
  await pool.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT * 2);
  await pool.connect(challenger).registerChallenge(constants.ONE_ETH.div(50));
  await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
  await pool.connect(challenger).confirmChallenge();

  return basicDeployment;
}
