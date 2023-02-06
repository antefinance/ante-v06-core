import { providers, Wallet } from 'ethers';

import { BasicFixture } from './basic.fixture';
import { oneSupportChallengeFixture } from './oneSupportChallenge.fixture';
import * as constants from '../constants';
import { evmIncreaseTime, evmSetNextBlockTimestamp } from '../helpers';

import hre from 'hardhat';
const { waffle } = hre;

export async function withdrawableStakeFixture(w: Wallet[], p: providers.Web3Provider): Promise<BasicFixture> {
  const [_1, _2, staker] = waffle.provider.getWallets();
  const basicDeployment = await oneSupportChallengeFixture(w, p);

  const pool = basicDeployment.oddBlockDeployment.pool;

  const unstakeTime = await pool.getUnstakeAllowedTime(staker.address);
  await evmSetNextBlockTimestamp(unstakeTime.toNumber());
  await pool.connect(staker).unstake(constants.HALF_ETH, false);

  await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS + 1);

  return basicDeployment;
}
