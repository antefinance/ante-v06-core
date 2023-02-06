import { providers, Wallet } from 'ethers';

import {
  AntePoolFactory,
  AntePoolFactory__factory,
  AnteOddBlockTest__factory,
  AnteOddBlockTest,
  AnteERC20,
  AntePoolFactoryController,
} from '../../typechain';
import { deployTestAndPool, givePoolAllowance, giveTokens } from '../helpers';
import * as constants from '../constants';
import AnteERC20Artifact from '../../artifacts/contracts/mock/AnteERC20.sol/AnteERC20.json';
import AntePoolFactoryControllerArtifact from '../../artifacts/contracts/AntePoolFactoryController.sol/AntePoolFactoryController.json';
import AntePoolLogicArtifact from '../../artifacts/contracts/AntePoolLogic.sol/AntePoolLogic.json';

import hre from 'hardhat';
import { AntePoolLogic } from '../../typechain/AntePoolLogic';
const { waffle } = hre;
const { deployContract } = waffle;

export interface BasicFixture {
  poolFactory: AntePoolFactory;
  oddBlockDeployment: constants.TestPoolDeployment<AnteOddBlockTest>;
  token: AnteERC20;
  controller: AntePoolFactoryController;
}

export async function basicFixture(w: Wallet[], p: providers.Web3Provider): Promise<BasicFixture> {
  const [deployer, author, staker, challenger, staker_2, challenger_2, unallowedStaker] = waffle.provider.getWallets();

  const token = (await deployContract(deployer, AnteERC20Artifact)) as AnteERC20;
  const controller = (await deployContract(deployer, AntePoolFactoryControllerArtifact)) as AntePoolFactoryController;
  await controller.connect(deployer).addToken(token.address, constants.MIN_TOKEN_AMOUNT);
  await controller.connect(deployer).setTokenMinimum(token.address, constants.MIN_CHALLENGER_STAKE);

  await giveTokens(deployer, token, [author, staker, challenger, staker_2, challenger_2, unallowedStaker]);

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

  await givePoolAllowance(oddBlockDeployment.pool, token, [
    deployer,
    author,
    staker,
    challenger,
    staker_2,
    challenger_2,
  ]);

  return {
    poolFactory,
    oddBlockDeployment,
    token,
    controller,
  };
}
