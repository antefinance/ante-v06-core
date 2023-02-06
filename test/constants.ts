import hre from 'hardhat';
import { IAntePool } from '../typechain';

export const ONE_ETH = hre.ethers.utils.parseEther('1');
export const HALF_ETH = ONE_ETH.div(2);
export const TWO_ETH = ONE_ETH.mul(2);
export const MIN_TOKEN_AMOUNT = ONE_ETH.div(1000);

export const ONE_BLOCK_DECAY = hre.ethers.BigNumber.from(100e9);
export const ANNUAL_DECAY_RATE = 15;
export const WEI_ROUNDING_ERROR_TOLERANCE = 3;

export const MAX_AUTHOR_REWARD_RATE = 10;
export const MIN_ANNUAL_DECAY_RATE = 5;
export const MAX_ANNUAL_DECAY_RATE = 50;
export const MIN_CHALLENGER_STAKE = ONE_ETH.div(100);
export const MIN_CHALLENGER_PAYOUT_RATIO = 2;
export const MAX_CHALLENGER_PAYOUT_RATIO = 20;
export const AUTHOR_REWARD_RATE = 10;
export const VERIFIER_BOUNTY_PCT = 5;
export const CHALLENGER_BLOCK_DELAY = 12;
export const CHALLENGER_TIMESTAMP_DELAY = 180;
export const ONE_DAY_IN_SECONDS = 86400;
export const ONE_YEAR_IN_SECONDS = ONE_DAY_IN_SECONDS * 365;
export const MIN_STAKE_COMMITMENT = ONE_DAY_IN_SECONDS;
export const MAX_STAKE_COMMITMENT = 2 * ONE_YEAR_IN_SECONDS;
export const CHALLENGER_PAYOUT_RATIO = 10;
export const ONE_YEAR_DECAY = ONE_ETH.mul(ANNUAL_DECAY_RATE).div(100);
export const ONE_SECOND_DECAY = ONE_YEAR_DECAY.div(ONE_YEAR_IN_SECONDS);

export const TOKENS = {
  WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
};

export interface TestPoolDeployment<T> {
  test: T;
  pool: IAntePool;
}
