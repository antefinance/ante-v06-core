import { expect } from 'chai';

import { antePoolTestFixture, AntePoolTestFixture } from '../fixtures/antePoolTest.fixture';
import { evmSnapshot, evmRevert } from '../helpers';

import hre from 'hardhat';
import { AnteStateTest } from '../../typechain/AnteStateTest';
import { defaultAbiCoder, hexZeroPad, solidityKeccak256 } from 'ethers/lib/utils';
const { waffle } = hre;
const { provider } = waffle;

describe('AnteTest state', function () {
  const wallets = provider.getWallets();
  const [_1, _2, staker] = wallets;

  let deployment: AntePoolTestFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let stateTestTest: AnteStateTest;

  before(async () => {
    deployment = await antePoolTestFixture(wallets, provider);
    globalSnapshotId = await evmSnapshot();
    snapshotId = await evmSnapshot();

    stateTestTest = deployment.stateTestDeployment.test;
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
  });

  describe('setStateAndCheckTestPasses', () => {
    it('can check test only if state is provided', async () => {
      const uintValue = 1;
      const addresses = [staker.address];
      const stringValue = 'fail';
      const bytesValue = solidityKeccak256(['string'], ['fail']);

      await stateTestTest.setStateAndCheckTestPasses(
        defaultAbiCoder.encode(
          ['uint256', 'address[]', 'string', 'bytes32'],
          [uintValue, addresses, stringValue, bytesValue]
        )
      );

      expect(await stateTestTest.uintValue()).to.be.equal(uintValue);
      expect(await stateTestTest.addresses(0)).to.be.equal(addresses[0]);
      expect(await stateTestTest.stringValue()).to.be.equal(stringValue);
      expect(await stateTestTest.bytesValue()).to.be.equal(bytesValue);
    });

    it('check test can set empty values', async () => {
      const uintValue = 0;
      const addresses: string[] = [];
      const stringValue = '';
      const bytesValue = hexZeroPad('0x', 32);

      const testState = defaultAbiCoder.encode(
        ['uint256', 'address[]', 'string', 'bytes32'],
        [uintValue, addresses, stringValue, bytesValue]
      );
      await stateTestTest.setStateAndCheckTestPasses(testState);

      expect(await stateTestTest.uintValue()).to.be.equal(uintValue);
      await expect(stateTestTest.addresses(0)).to.be.reverted;
      expect(await stateTestTest.stringValue()).to.be.equal(stringValue);
      expect(await stateTestTest.bytesValue()).to.be.equal(bytesValue);
    });

    it('returns the expected state types', async () => {
      expect(await stateTestTest.getStateTypes()).to.be.equal('uint256,address[],string,bytes32');
    });

    it('returns the expected state names', async () => {
      expect(await stateTestTest.getStateNames()).to.be.equal('uintValue,addresses,stringValue,bytesValue');
    });

    it('returns the empty string for tests without state', async () => {
      expect(await deployment.oddBlockDeployment.test.getStateTypes()).to.be.equal('');
    });
  });
});
