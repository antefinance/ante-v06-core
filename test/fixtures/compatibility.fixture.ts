import { providers, Wallet } from 'ethers';

import {
  AntePoolFactory,
  AnteERC20,
  AntePoolFactoryController,
  InterfaceEnforcingAnteTest,
  IAntePool,
  AntePoolLogic,
} from '../../typechain';
import { deployPool, evmIncreaseTime, evmMineBlocks, givePoolAllowance, giveTokens } from '../helpers';
import AntePoolLogicArtifact from '../../artifacts/contracts/AntePoolLogic.sol/AntePoolLogic.json';
import AnteERC20Artifact from '../../artifacts/contracts/mock/AnteERC20.sol/AnteERC20.json';
import InterfaceEnforcingAnteTestArtifact from '../../artifacts/contracts/mock/InterfaceEnforcingAnteTest.sol/InterfaceEnforcingAnteTest.json';
import AntePoolFactoryArtifact from '../../artifacts/contracts/AntePoolFactory.sol/AntePoolFactory.json';
import AntePoolFactoryControllerArtifact from '../../artifacts/contracts/AntePoolFactoryController.sol/AntePoolFactoryController.json';

import hre from 'hardhat';
import {
  CHALLENGER_PAYOUT_RATIO,
  CHALLENGER_TIMESTAMP_DELAY,
  MIN_CHALLENGER_STAKE,
  MIN_STAKE_COMMITMENT,
  MIN_TOKEN_AMOUNT,
  ONE_DAY_IN_SECONDS,
  ONE_ETH,
} from '../constants';
const { waffle } = hre;
const { deployContract } = waffle;

export interface CompatibilityFixture {
  poolFactory: AntePoolFactory;
  token: AnteERC20;
  pool: IAntePool;
  test: InterfaceEnforcingAnteTest;
}

export async function compatibilityFixture(_w: Wallet[], _p: providers.Web3Provider): Promise<CompatibilityFixture> {
  const [deployer, author, staker, challenger, staker_2, challenger_2] = waffle.provider.getWallets();

  const token = (await deployContract(deployer, AnteERC20Artifact)) as AnteERC20;
  const controller = (await deployContract(deployer, AntePoolFactoryControllerArtifact)) as AntePoolFactoryController;
  const poolFactory = (await deployContract(deployer, AntePoolFactoryArtifact, [
    controller.address,
  ])) as AntePoolFactory;
  const logic = (await deployContract(deployer, AntePoolLogicArtifact)) as AntePoolLogic;

  await controller.connect(deployer).addToken(token.address, MIN_TOKEN_AMOUNT);
  await controller.connect(deployer).setTokenMinimum(token.address, MIN_CHALLENGER_STAKE);
  await controller.connect(deployer).setPoolLogicAddr(logic.address);

  await giveTokens(deployer, token, [author, staker, challenger, staker_2, challenger_2]);

  const test = (await deployContract(author, InterfaceEnforcingAnteTestArtifact)) as InterfaceEnforcingAnteTest;
  const pool = await deployPool(poolFactory, test.address, {
    tokenAddress: token.address,
  });

  await givePoolAllowance(pool, token, [deployer, author, staker, challenger, staker_2, challenger_2]);

  await pool.connect(staker).stake(ONE_ETH, MIN_STAKE_COMMITMENT);

  await pool.connect(challenger).registerChallenge(ONE_ETH.div(CHALLENGER_PAYOUT_RATIO));
  await evmIncreaseTime(CHALLENGER_TIMESTAMP_DELAY);
  await pool.connect(challenger).confirmChallenge();

  await evmMineBlocks(20);
  await evmIncreaseTime(ONE_DAY_IN_SECONDS);

  return {
    poolFactory,
    token,
    pool,
    test,
  };
}
