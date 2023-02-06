import { providers, Wallet } from 'ethers';

import {
  AntePoolFactory,
  AntePoolFactory__factory,
  AnteConditionalTest__factory,
  AntePoolFactoryController,
  AnteERC20,
  AnteConditionalTest,
  IAntePool,
  AntePoolLogic,
} from '../../typechain';

import * as constants from '../constants';

import hre from 'hardhat';
import { deployTestAndPool, evmIncreaseTime, deployPool, givePoolAllowance, giveTokens } from '../helpers';
import { deployContract } from 'ethereum-waffle';
const { waffle } = hre;

import AntePoolLogicArtifact from '../../artifacts/contracts/AntePoolLogic.sol/AntePoolLogic.json';
import AnteERC20Artifact from '../../artifacts/contracts/mock/AnteERC20.sol/AnteERC20.json';
import AntePoolFactoryControllerArtifact from '../../artifacts/contracts/AntePoolFactoryController.sol/AntePoolFactoryController.json';

export interface MultiPoolTestFixture {
  poolFactory: AntePoolFactory;
  token: AnteERC20;
  controller: AntePoolFactoryController;
  test: AnteConditionalTest;
  pool0: IAntePool;
  pool1: IAntePool;
  pool2: IAntePool;
}

export async function multiPoolSameTest(): Promise<MultiPoolTestFixture> {
  const [deployer, author, staker, challenger, staker2, challenger2, _staker3, challenger3] =
    waffle.provider.getWallets();

  const token = (await deployContract(deployer, AnteERC20Artifact)) as AnteERC20;

  const controller = (await deployContract(deployer, AntePoolFactoryControllerArtifact)) as AntePoolFactoryController;
  await controller.connect(deployer).addToken(token.address, constants.MIN_TOKEN_AMOUNT);
  await controller.connect(deployer).setTokenMinimum(token.address, constants.MIN_CHALLENGER_STAKE);

  const factory = (await hre.ethers.getContractFactory('AntePoolFactory', deployer)) as AntePoolFactory__factory;
  const poolFactory: AntePoolFactory = await factory.deploy(controller.address);
  await poolFactory.deployed();

  const logic = (await deployContract(deployer, AntePoolLogicArtifact)) as AntePoolLogic;
  await controller.connect(deployer).setPoolLogicAddr(logic.address);

  const conditionalFactory = (await hre.ethers.getContractFactory(
    'AnteConditionalTest',
    author
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

  // Send tokens to stakers and challengers
  await giveTokens(deployer, token, [author, staker, staker2, challenger, challenger2, challenger3]);

  /* Sets up the following state:
   * Ante Pool       Stake             Challenge
   * -----------------------------------------------
   * P0              2 ETH (2 stakers)  0.1 ETH (2 challengers)
   * P1              2 ETH (2 stakers)  0.1 ETH (1 challenger)
   * P2              1 ETH (1 staker)   0 ETH (0 challengers)
   */

  const { pool: pool0, test } = conditionalTestDeployment;
  await givePoolAllowance(pool0, token, [author, staker, staker2, challenger, challenger2, challenger3]);

  await pool0.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);
  await pool0.connect(staker2).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);

  await pool0.connect(challenger).registerChallenge(constants.ONE_ETH.div(20));
  await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
  await pool0.connect(challenger).confirmChallenge();

  await pool0.connect(challenger2).registerChallenge(constants.ONE_ETH.div(20));
  await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
  await pool0.connect(challenger2).confirmChallenge();

  const pool1 = await deployPool(poolFactory, test.address, {
    tokenAddress: token.address,
    decayRate: 8,
  });
  await givePoolAllowance(pool1, token, [author, staker, staker2, challenger, challenger2, challenger3]);

  await pool1.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);

  await pool1.connect(staker2).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);

  await pool1.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
  await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
  await pool1.connect(challenger).confirmChallenge();

  const pool2 = await deployPool(poolFactory, test.address, {
    tokenAddress: token.address,
    decayRate: 9,
  });
  await givePoolAllowance(pool2, token, [author, staker, staker2, challenger, challenger2, challenger3]);

  await pool2.connect(staker).stake(constants.ONE_ETH, constants.MIN_STAKE_COMMITMENT);

  return {
    poolFactory,
    token,
    controller,
    test,
    pool0,
    pool1,
    pool2,
  };
}
