import hre from 'hardhat';

const { waffle } = hre;

import { ContractFactory, Contract, BigNumber, Wallet, Signer, utils } from 'ethers';
import * as constants from './constants';
import { AntePoolFactory, IAntePool, IERC20 } from '../typechain';

import { expect, assert } from 'chai';
import { solidityKeccak256 } from 'ethers/lib/utils';

type CreatePoolArgs = {
  testAddress?: string;
  tokenAddress: string;
  testAuthorRewardRate?: number;
  decayRate?: number;
  payoutRatio?: number;
};

export async function blockTimestamp(): Promise<number> {
  return (await waffle.provider.getBlock('latest')).timestamp;
}

export async function blockNumber(): Promise<number> {
  return (await waffle.provider.getBlock('latest')).number;
}

export async function evmSnapshot(): Promise<any> {
  return await hre.network.provider.request({
    method: 'evm_snapshot',
    params: [],
  });
}

export async function evmRevert(snapshotId: string): Promise<void> {
  await hre.network.provider.request({
    method: 'evm_revert',
    params: [snapshotId],
  });
}

export async function evmSetNextBlockTimestamp(timestamp: number): Promise<void> {
  await hre.network.provider.send('evm_setNextBlockTimestamp', [timestamp]);
}

export async function evmIncreaseTime(seconds: number): Promise<void> {
  await hre.network.provider.send('evm_increaseTime', [seconds]);
}

export async function evmMineBlocks(numBlocks: number): Promise<void> {
  for (let i = 0; i < numBlocks; i++) {
    await hre.network.provider.send('evm_mine');
  }
}

export async function evmLastMinedBlockNumber(): Promise<BigNumber> {
  return BigNumber.from(await hre.network.provider.send('eth_blockNumber'));
}

export async function triggerOddBlockTestFailure(
  pool: Contract,
  challenger: Wallet,
  waitTwelveBlocks = true
): Promise<void> {
  if (waitTwelveBlocks) {
    await evmMineBlocks(12);
  }

  // make sure checkTest is triggered on even block
  const block_num = await hre.network.provider.send('eth_blockNumber');
  if (block_num % 2 != 1) {
    await hre.network.provider.send('evm_mine');
  }
  await pool.connect(challenger).checkTest();

  assert(await pool.pendingFailure());
}

export async function deployTestAndPool<T extends Contract>(
  deployer: any,
  poolFactory: AntePoolFactory,
  testContractFactory: ContractFactory,
  testArgs: any[],
  poolArgs: CreatePoolArgs
): Promise<constants.TestPoolDeployment<T>> {
  const testContract = (await testContractFactory.connect(deployer).deploy(...testArgs)) as T;
  await testContract.deployed();

  return {
    test: testContract,
    pool: await deployPool(poolFactory, testContract.address, poolArgs),
  };
}

export async function deployPool(
  poolFactory: AntePoolFactory,
  testAddress: string,
  poolArgs: CreatePoolArgs
): Promise<IAntePool> {
  const {
    tokenAddress,
    testAuthorRewardRate = constants.AUTHOR_REWARD_RATE,
    payoutRatio = constants.CHALLENGER_PAYOUT_RATIO,
    decayRate = constants.ANNUAL_DECAY_RATE,
  } = poolArgs;

  const tx = await poolFactory.createPool(testAddress, tokenAddress, payoutRatio, decayRate, testAuthorRewardRate);
  const receipt = await tx.wait();

  const testPoolAddress = receipt.events?.[0].args?.['testPool'];
  const poolContract = <IAntePool>await hre.ethers.getContractAt('AntePoolLogic', testPoolAddress);

  return poolContract;
}

export async function calculateGasUsed(txpromise: any): Promise<BigNumber> {
  const txreceipt = await txpromise.wait();
  return txreceipt.effectiveGasPrice.mul(txreceipt.cumulativeGasUsed);
}

type DecayInfo = {
  totalDecay: BigNumber;
  stakerDecayShare: BigNumber;
  authorDecayShare: BigNumber;
};

export function calculateDecay(initialAmount: BigNumber, numSeconds: number): DecayInfo {
  const decayRate = calculateTimestampDecay(constants.ONE_ETH, constants.ANNUAL_DECAY_RATE, numSeconds);
  const totalDecay = initialAmount.mul(decayRate).div(constants.ONE_ETH);
  const authorDecayShare = totalDecay.mul(constants.AUTHOR_REWARD_RATE).div(100);
  const stakerDecayShare = totalDecay.sub(authorDecayShare);
  return { totalDecay, authorDecayShare, stakerDecayShare };
}

export function calculateTimestampDecay(
  initialAmount: BigNumber,
  annualDecayRate: number,
  numSeconds: number
): BigNumber {
  return initialAmount.mul(annualDecayRate).mul(numSeconds).div(100).div(constants.ONE_YEAR_IN_SECONDS);
}

type ComputedDecayInfo = {
  decayMultiplierThisUpdate: BigNumber;
  decayThisUpdate: BigNumber;
  decayForAuthor: BigNumber;
  decayForStakers: BigNumber;
};

// This function replicates the exact functionality of _computeDecay in AntePool.sol for independently
// calculating expected values
export async function computeDecay(
  totalChallengerStaked: BigNumber,
  pool: IAntePool,
  numSeconds: number
): Promise<ComputedDecayInfo> {
  const testAuthorRewardRate = await pool.testAuthorRewardRate();
  let decayMultiplierThisUpdate = constants.ONE_ETH;
  let decayThisUpdate = BigNumber.from(0);
  let decayForStakers = BigNumber.from(0);
  let decayForAuthor = BigNumber.from(0);
  const decayRateThisUpdate = calculateTimestampDecay(constants.ONE_ETH, constants.ANNUAL_DECAY_RATE, numSeconds);
  // Failsafe to avoid underflow when calculating decayMultiplierThisUpdate

  if (decayRateThisUpdate.gte(constants.ONE_ETH)) {
    decayMultiplierThisUpdate = BigNumber.from(0);
    decayThisUpdate = totalChallengerStaked;
  } else {
    decayMultiplierThisUpdate = constants.ONE_ETH.sub(decayRateThisUpdate);
    decayThisUpdate = totalChallengerStaked.mul(decayRateThisUpdate).div(constants.ONE_ETH);
  }

  decayForAuthor = decayThisUpdate.mul(testAuthorRewardRate).div(100);
  decayForStakers = decayThisUpdate.sub(decayForAuthor);
  return { decayMultiplierThisUpdate, decayThisUpdate, decayForAuthor, decayForStakers };
}
// This function replicates the exact functionality of getStoredBalance in AntePool.sol for independently
// calculating expected values
export async function getExpectedStoredBalance(
  user: Wallet,
  pool: IAntePool,
  secondsFromNow: number,
  isChallenger: boolean
): Promise<BigNumber> {
  const totalChallengerStaked = await pool.getTotalChallengerStaked();
  const secondsToNow = (await blockTimestamp()) - (await pool.lastUpdateTimestamp()).toNumber();
  const { decayMultiplierThisUpdate, decayForStakers } = await computeDecay(
    totalChallengerStaked,
    pool,
    secondsToNow + secondsFromNow
  );

  let decayMultiplier: BigNumber = (await (isChallenger ? pool.challengerInfo() : pool.stakingInfo())).decayMultiplier;

  if (isChallenger) {
    decayMultiplier = decayMultiplier.mul(decayMultiplierThisUpdate).div(constants.ONE_ETH);
  } else {
    const totalStaked = await pool.getTotalStaked();
    const totalStakedNew = totalStaked.add(decayForStakers);
    decayMultiplier = decayMultiplier.mul(totalStakedNew).div(totalStaked);
  }
  const startAmount = await pool.getUserStartAmount(user.address, isChallenger);
  if (startAmount.eq(0)) return startAmount;
  const startDecayMultiplier = await pool.getUserStartDecayMultiplier(user.address, isChallenger);

  return startAmount.mul(decayMultiplier).div(startDecayMultiplier);
}

export async function getExpectedFutureAuthorReward(pool: IAntePool, numSeconds: number): Promise<BigNumber> {
  const totalChallengerStaked = await pool.getTotalChallengerStaked();
  const authorRewardRate = await pool.testAuthorRewardRate();
  const decayRate = await pool.decayRate();

  const decay = calculateTimestampDecay(totalChallengerStaked, decayRate.toNumber(), numSeconds);

  return decay.mul(authorRewardRate).div(100);
}

export async function getExpectedFutureStakerBalance(
  staker: Wallet,
  pool: IAntePool,
  numSeconds: number
): Promise<BigNumber> {
  return await getExpectedStoredBalance(staker, pool, numSeconds, false);
}

export async function getExpectedFutureChallengerBalance(
  challenger: Wallet,
  pool: IAntePool,
  numSeconds: number
): Promise<BigNumber> {
  return await getExpectedStoredBalance(challenger, pool, numSeconds, true);
}

export async function getExpectedCurrentChallengerDecay(challenger: Wallet, pool: IAntePool): Promise<BigNumber> {
  const challengerInfo = await pool.getChallengerInfo(challenger.address);
  const challengerStake = challengerInfo.startAmount;
  const decayRate = await pool.decayRate();
  const now = await blockTimestamp();
  const timeElapsed = now - challengerInfo.lastStakedTimestamp.toNumber();
  return calculateTimestampDecay(challengerStake, decayRate.toNumber(), timeElapsed);
}

export async function getExpectedCurrentChallengerBalance(challenger: Wallet, pool: IAntePool): Promise<BigNumber> {
  return await getExpectedFutureChallengerBalance(challenger, pool, 0);
}

export async function getExpectedCurrentStakerBalance(staker: Wallet, pool: IAntePool): Promise<BigNumber> {
  return await getExpectedFutureStakerBalance(staker, pool, 0);
}

export function expectAlmostEqual(num1: BigNumber, num2: BigNumber, tolerance: number): void {
  expect(num1.sub(num2).abs()).to.be.lte(tolerance);
}

export async function getExpectedChallengerPayoutWithoutBounty(
  challenger: Wallet,
  pool: IAntePool
): Promise<BigNumber> {
  const totalChallenged = await pool.getTotalChallengerEligibleBalance();
  const totalStaked = (await pool.getTotalStaked()).add(await pool.getTotalPendingWithdraw());
  const bounty = await pool.getVerifierBounty();

  const challengerBalance = await pool.getStoredBalance(challenger.address, true);

  const { claimableShares: challengerShares, claimableSharesStartMultiplier } = await pool.getChallengerInfo(
    challenger.address
  );
  const decayMultiplier = (await pool.challengerInfo()).decayMultiplier;
  const claimableShares = challengerShares.mul(decayMultiplier).div(claimableSharesStartMultiplier);
  const claimableFunds = totalStaked.sub(bounty);

  return challengerBalance.add(claimableFunds.mul(claimableShares).div(totalChallenged));
}

export async function getPoolConfigHash(pool: IAntePool): Promise<string> {
  const testAddress = await pool.anteTest();
  const token = await pool.token();
  const minChallengerStake = await pool.minChallengerStake();
  const payoutRatio = await pool.challengerPayoutRatio();
  const decayRate = await pool.decayRate();
  const authorRewardRate = await pool.testAuthorRewardRate();

  return solidityKeccak256(
    ['address', 'address', 'uint256', 'uint256', 'uint256', 'uint256'],
    [testAddress, token, minChallengerStake, payoutRatio, decayRate, authorRewardRate]
  );
}

export async function generateSignerFromAddress(address: string): Promise<Signer> {
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  });

  await hre.network.provider.send('hardhat_setBalance', [address, utils.parseEther('10.0').toHexString()]);

  return await hre.ethers.getSigner(address);
}

export async function giveTokens(
  deployer: Wallet,
  token: IERC20,
  wallets: Wallet[],
  amount: BigNumber = constants.ONE_ETH.mul(1000)
): Promise<void> {
  for (const wallet of wallets) {
    await token.connect(deployer).transfer(wallet.address, amount);
  }
}

export async function givePoolAllowance(
  pool: IAntePool,
  token: IERC20,
  wallets: Wallet[],
  amount: BigNumber = constants.ONE_ETH.mul(100)
): Promise<void> {
  for (const wallet of wallets) {
    await token.connect(wallet).approve(pool.address, amount);
  }
}
export async function getLogicContract<T extends Contract>(proxyAddress: string): Promise<T> {
  const logicContractAddress = hre.ethers.utils.hexValue(
    await hre.ethers.provider.getStorageAt(
      proxyAddress,
      '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
    )
  );
  const logicContract = <T>await hre.ethers.getContractAt('AntePoolLogic', logicContractAddress);

  return logicContract;
}
