import { BigNumber, providers, Wallet } from 'ethers';

import {
  AntePoolFactory,
  AntePoolFactory__factory,
  AnteOddBlockTest__factory,
  AnteUSDCSupplyTest__factory,
  AnteConditionalTest__factory,
  AntePoolFactoryController,
  AnteERC20,
  AnteOddBlockTest,
  AnteUSDCSupplyTest,
  AnteConditionalTest,
  AntePoolLogic,
} from '../../typechain';

import * as constants from '../constants';

import hre from 'hardhat';
import { deployTestAndPool, evmMineBlocks, evmIncreaseTime, givePoolAllowance, giveTokens } from '../helpers';
import { deployContract } from 'ethereum-waffle';
const { waffle } = hre;

import AntePoolLogicArtifact from '../../artifacts/contracts/AntePoolLogic.sol/AntePoolLogic.json';
import AnteERC20Artifact from '../../artifacts/contracts/mock/AnteERC20.sol/AnteERC20.json';
import AntePoolFactoryControllerArtifact from '../../artifacts/contracts/AntePoolFactoryController.sol/AntePoolFactoryController.json';

export interface MultiPoolTestFixture {
  token: AnteERC20;
  poolFactory: AntePoolFactory;
  oddBlockDeployment: constants.TestPoolDeployment<AnteOddBlockTest>;
  usdcSupplyTestDeployment: constants.TestPoolDeployment<AnteUSDCSupplyTest>;
  conditionalTestDeployment: constants.TestPoolDeployment<AnteConditionalTest>;
}

export async function multiPoolTestFixture(w: Wallet[], p: providers.Web3Provider): Promise<MultiPoolTestFixture> {
  const [deployer, author, staker, challenger, staker_2] = waffle.provider.getWallets();

  const token = (await deployContract(deployer, AnteERC20Artifact)) as AnteERC20;
  await giveTokens(deployer, token, [staker, challenger, staker_2]);

  const controller = (await deployContract(deployer, AntePoolFactoryControllerArtifact)) as AntePoolFactoryController;
  await controller.connect(deployer).addToken(token.address, constants.MIN_TOKEN_AMOUNT);
  await controller.connect(deployer).setTokenMinimum(token.address, constants.MIN_CHALLENGER_STAKE);

  const factory = (await hre.ethers.getContractFactory('AntePoolFactory', deployer)) as AntePoolFactory__factory;
  const poolFactory: AntePoolFactory = await factory.deploy(controller.address);
  await poolFactory.deployed();

  const logic = (await deployContract(deployer, AntePoolLogicArtifact)) as AntePoolLogic;
  await controller.connect(deployer).setPoolLogicAddr(logic.address);

  const oddBlockFactory = (await hre.ethers.getContractFactory(
    'AnteOddBlockTest',
    author
  )) as AnteOddBlockTest__factory;
  const oddBlockDeployment = await deployTestAndPool<AnteOddBlockTest>(author, poolFactory, oddBlockFactory, [], {
    tokenAddress: token.address,
  });
  await oddBlockDeployment.test.setWillTest(true);

  const usdcFactory = (await hre.ethers.getContractFactory(
    'AnteUSDCSupplyTest',
    author
  )) as AnteUSDCSupplyTest__factory;
  const usdcSupplyTestDeployment = await deployTestAndPool<AnteUSDCSupplyTest>(
    author,
    poolFactory,
    usdcFactory,
    ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
    {
      tokenAddress: token.address,
    }
  );

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

  /* Sets up the following state:
   * Ante Test           Stake             Challenge
   * -----------------------------------------------
   * AnteOddBlockTest  900 ETH (unlocked)      1 ETH
   * AnteUSDCSupplyTest  1 ETH                 1 ETH
   * AnteConditionalTest   1 ETH                 1 ETH
   */
  const oddBlockPool = oddBlockDeployment.pool;
  const usdcPool = usdcSupplyTestDeployment.pool;
  const conditionalPool = conditionalTestDeployment.pool;

  await givePoolAllowance(oddBlockPool, token, [staker, challenger, staker_2], constants.ONE_ETH.mul(900));
  await givePoolAllowance(usdcPool, token, [staker, challenger, staker_2]);
  await givePoolAllowance(conditionalPool, token, [staker, challenger, staker_2]);

  await oddBlockPool.connect(staker).stake(constants.ONE_ETH.mul(20), constants.MIN_STAKE_COMMITMENT);
  await oddBlockPool.connect(staker_2).stake(constants.ONE_ETH.mul(900), constants.MIN_STAKE_COMMITMENT);
  await usdcPool.connect(staker).stake(constants.ONE_ETH.mul(5), constants.MIN_STAKE_COMMITMENT);
  await conditionalPool.connect(staker).stake(constants.ONE_ETH.mul(5), constants.MIN_STAKE_COMMITMENT);

  await oddBlockPool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
  await usdcPool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
  await conditionalPool.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));

  await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);

  await oddBlockPool.connect(challenger).confirmChallenge();
  await usdcPool.connect(challenger).confirmChallenge();
  await conditionalPool.connect(challenger).confirmChallenge();

  await evmIncreaseTime(constants.MIN_STAKE_COMMITMENT);
  // intiate withdraw of some of stake and prime challengers
  await oddBlockPool.connect(staker).unstakeAll(false);
  await evmIncreaseTime(constants.ONE_DAY_IN_SECONDS + 1);
  await evmMineBlocks(12);

  return {
    poolFactory,
    oddBlockDeployment,
    usdcSupplyTestDeployment,
    conditionalTestDeployment,
    token,
  };
}
