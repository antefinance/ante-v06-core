import { providers, Wallet } from 'ethers';

import { ConditionalTestFixture, conditionalTestFixture } from './conditionalTest.fixture';

import hre from 'hardhat';
const { waffle } = hre;

import { assert } from 'chai';
import { evmIncreaseTime } from '../helpers';
import * as constants from '../constants';

export async function failedTestFixture(w: Wallet[], p: providers.Web3Provider): Promise<ConditionalTestFixture> {
  const [_deployer, _author, _staker, challenger] = waffle.provider.getWallets();
  const conditionalTestDeployment = await conditionalTestFixture(w, p);

  // stake 1 ETH on staker and challenger side
  const { pool, test } = conditionalTestDeployment.conditionalTestDeployment;

  // Let some decay accumulate
  await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS);

  // trigger test failure
  await test.setWillFail(true);
  await pool.connect(challenger).checkTest();

  assert(await pool.pendingFailure());

  return conditionalTestDeployment;
}
