import { HardhatRuntimeEnvironment } from 'hardhat/types';
import path from 'path';

import * as constants from '../scripts/constants';
import {
  currentCommitHash,
  upgradeProxyAndRecord,
  emptyDeployment,
  loadDeployment,
  saveDeployment,
} from '../scripts/helpers';

interface TaskArgs {
  name: string;
}

const upgradeDTSImplementationTask = async ({ name }: TaskArgs, hre: HardhatRuntimeEnvironment): Promise<void> => {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;
  const deploymentFile = path.resolve(__dirname, `./deployments/${network}.json`);
  console.log(`Upgrading DecentralizedTrustScore contract to network ${network} from deployer ${deployer.address}`);
  let deployment: constants.Deployment;
  console.log(`Attempting to load existing deployment from file ${deploymentFile}`);
  try {
    deployment = loadDeployment(deploymentFile);
  } catch (e) {
    console.log(`no existing deployment found, initializing empty deployment...`);
    deployment = emptyDeployment();
  }
  const curCommitHash = currentCommitHash();
  if (deployment['commit'] != '' && deployment['commit'] != curCommitHash) {
    throw new Error('commit hash on existing deployment does not match repository commit hash');
  }
  deployment['commit'] = curCommitHash;
  await upgradeProxyAndRecord(hre, deployment, 'AnteDecentralizedTrustScoreV1', name, []);
  console.log(`Saving deployment`);
  saveDeployment(deploymentFile, deployment);
};

export default upgradeDTSImplementationTask;
