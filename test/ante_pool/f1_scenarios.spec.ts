import { basicFixture, BasicFixture } from '../fixtures/basic.fixture';
import { evmSnapshot, evmRevert, blockTimestamp, evmSetNextBlockTimestamp, evmMineBlocks } from '../helpers';
import hre from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider } = waffle;
import fs from 'fs';
import path from 'path';

import { IAntePool } from '../../typechain';
import {
  Action,
  ActionType,
  ACTION_TYPES,
  ChainActionType,
  CHAIN_ACTIONS,
  MetaActionType,
  META_ACTIONS,
  SignedActionType,
  SIGNED_ACTIONS,
} from './f1_scenarios.types';
import {
  CHAIN_ACTIONS_HANDLERS,
  DEPLOYMENT_HANDLERS,
  META_ACTIONS_HANDLERS,
  SIGNED_ACTIONS_HANDLERS,
} from './f1_scenarios.handlers';

/**
 * @param fullpath Path to a CSV file of scenarios
 * @returns A list of scenarios, of type:
 * [
 *   ["My scenario name", [
 *     {
 *       actionType: "STAKE",
 *       amount: 1,
 *       signerIndex: 0,
 *       amountsToCheck: [signerToCheck, isCounter, expectedAmount]
 *     },
 *     ...
 *   ]]
 * ]
 */
function loadScenarios(fullPath: string) {
  const text = fs.readFileSync(fullPath, 'utf8');

  const lines = text.split(/\r\n|\n/);
  const scenarios = [];

  let scenarioName: string = '';
  let actions: Action<any>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].split(',');

    // New scenario.
    if (line[0] && line[0] !== scenarioName) {
      scenarioName = line[0];
      actions = [];
      scenarios.push({ scenarioName, actions });
    }

    // Read the action stored on this line.
    try {
      const actionType = line[1];
      const params: Record<string, any> = {};
      // Skip line if it has no action
      if (!actionType || actionType.length === 0) {
        continue;
      } else {
        if (!ACTION_TYPES.hasOwnProperty(actionType)) {
          throw new Error(`${actionType} is an invalid action type`);
        }
      }

      // Expecting to process cells 2 by 2
      // Odd cells represent a parameter name
      // Even cells represent the parameter value
      // E.g C3 = amount C4 = 1, C5 = signer, C6 =
      for (let j = 2; j < line.length - 1; j = j + 2) {
        // Skip cell processing if either the name or the value is empty
        if (line[j].length === 0 || line[j + 1].length === 0) {
          continue;
        }

        const paramName = line[j];
        const paramValue = line[j + 1];
        params[paramName] = paramValue;
      }

      if (SIGNED_ACTIONS.hasOwnProperty(actionType) && params.signer === undefined) {
        throw new Error('Undefined signer for actionType=' + actionType);
      }

      actions.push({
        type: actionType as ActionType,
        params,
      });
    } catch (error: any) {
      error.message = 'Line ' + i + ': ' + error.message;
      throw error;
    }
  }
  return scenarios;
}

const basePath = path.join(process.cwd());
const baseScenarioPath = path.join(path.join(basePath, 'test'), 'ante_pool');

const scenarios = loadScenarios(path.join(baseScenarioPath, 'scenarios.csv'));

describe('Scenarios', function () {
  const wallets = provider.getWallets();

  let deployment: BasicFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let pool: IAntePool;
  let hasSetNextBlock: boolean;

  before(async () => {
    deployment = await loadFixture(basicFixture);
    globalSnapshotId = await evmSnapshot();
    snapshotId = await evmSnapshot();
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  scenarios.forEach((s) => {
    const { scenarioName, actions } = s;
    describe(scenarioName, async () => {
      before(async () => {
        if (actions.length > 0 && actions[0].type === ACTION_TYPES.DEPLOY) {
          pool = await DEPLOYMENT_HANDLERS.DEPLOY(deployment, actions[0]);
        } else {
          pool = deployment.oddBlockDeployment.pool;
        }
      });

      after(async () => {
        await evmRevert(snapshotId);
        snapshotId = await evmSnapshot();
      });

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const actionType = action.type;
        if (actionType === 'DEPLOY' && i > 0) {
          throw new Error('DEPLOY can be used only as the first action within a scenario');
        }

        let testName = actionType + JSON.stringify(action.params);

        it(testName, async () => {
          // Execute the action
          if (SIGNED_ACTIONS.hasOwnProperty(actionType)) {
            // If next block timestamp hasn't been set by CHAIN_ACTIONS
            if (!hasSetNextBlock) {
              const nextBlockTimestamp = (await blockTimestamp()) + 1;
              // Enforce a 1 second block to keep the test suite consistent.
              await evmSetNextBlockTimestamp(nextBlockTimestamp);
            }
            await SIGNED_ACTIONS_HANDLERS[actionType as SignedActionType](pool, wallets, action);
            hasSetNextBlock = false;
          } else if (CHAIN_ACTIONS.hasOwnProperty(actionType)) {
            await CHAIN_ACTIONS_HANDLERS[actionType as ChainActionType](action);
            hasSetNextBlock = true;
          } else if (META_ACTIONS.hasOwnProperty(actionType)) {
            if (hasSetNextBlock) {
              await evmMineBlocks(1);
            }
            await META_ACTIONS_HANDLERS[actionType as MetaActionType](deployment, pool, action);
            hasSetNextBlock = false;
          }
        });
      }
    });
  });
});
