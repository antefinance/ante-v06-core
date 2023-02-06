import { config as dotenvconfig } from 'dotenv';
dotenvconfig();
import { HardhatUserConfig, task } from 'hardhat/config';

//const { private_key, infura_key, alchemy_key } = require('./secret.json');

import 'hardhat-abi-exporter';
import 'hardhat-gas-reporter';
import '@typechain/hardhat';
import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-etherscan';
import '@tenderly/hardhat-tenderly';
import '@openzeppelin/hardhat-upgrades';
import 'solidity-coverage';

import upgradeDTSImplementationTask from './tasks/upgrade_dts_proxy';

const config: HardhatUserConfig = {
  networks: {
    localhost: {
      forking: {
        url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`,
        blockNumber: 13089428,
      },
      url: 'http://localhost:8545',
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${process.env.INFURA_KEY}`,
      accounts: {
        mnemonic: process.env.MAINNET_MNEMONIC || '',
      },
    },
    goerli: {
      url: `https://goerli.infura.io/v3/${process.env.INFURA_KEY}`,
      accounts: {
        mnemonic: process.env.GOERLI_MNEMONIC || '',
      },
    },
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/${process.env.INFURA_KEY}`,
      accounts: {
        mnemonic: process.env.RINKEBY_MNEMONIC || '',
      },
    },
    hardhat: {
      forking: {
        url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`,
        blockNumber: 13089428,
      },
    },
  },
  solidity: {
    version: '0.8.16',
    settings: {
      optimizer: {
        enabled: true,
        runs: 10000,
      },
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_KEY,
  },
};

task('upgradeDTSProxy', 'Upgrade the DTS implementation contract')
  .addPositionalParam('name', 'The name of the new implementation contract')
  .setAction(upgradeDTSImplementationTask);

export default config;
