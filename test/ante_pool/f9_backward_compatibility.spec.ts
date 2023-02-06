import { evmSnapshot, evmRevert } from '../helpers';

import hre from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider } = waffle;

import { expect } from 'chai';
import { IAntePool, InterfaceEnforcingAnteTest } from '../../typechain';
import { CompatibilityFixture, compatibilityFixture } from '../fixtures/compatibility.fixture';
import { defaultAbiCoder } from 'ethers/lib/utils';
import { Contract } from 'ethers';

describe('AntePool v0.6 compatibility with AnteTest v0.5', function () {
  const wallets = provider.getWallets();
  const [deployer, _author, staker, challenger] = wallets;

  let deployment: CompatibilityFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let pool: IAntePool;
  let test: InterfaceEnforcingAnteTest;

  before(async () => {
    deployment = await loadFixture(compatibilityFixture);

    globalSnapshotId = await evmSnapshot();
    snapshotId = await evmSnapshot();

    pool = deployment.pool;
    test = deployment.test;
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
  });

  describe('checkTest', () => {
    it("should pass if 'setStateAndCheckTestPasses' method does not exist on AnteTest", async () => {
      const state = defaultAbiCoder.encode(['address'], [staker.address]);

      await pool.connect(challenger).checkTestWithState(state);
      expect(await pool.pendingFailure()).to.be.false;
    });

    it('should revert if checking test with state', async () => {
      // We need to fake out the Test contract otherwise
      // Hardhat throws "setStateAndCheckTestPasses is not a function" error
      const nonExistentFuncSignature = 'setStateAndCheckTestPasses(bytes)';
      const fakeTestContract = new Contract(
        test.address,
        [...test.interface.fragments, `function ${nonExistentFuncSignature}`],
        deployer
      );

      const state = defaultAbiCoder.encode(['address'], [staker.address]);

      await expect(fakeTestContract.connect(challenger)[nonExistentFuncSignature](state)).to.be.revertedWith(
        'Method not supported by v0.5'
      );
    });

    it('should pass if checking test without state', async () => {
      await expect(pool.connect(challenger).checkTest()).to.not.be.reverted;
    });
  });

  it('can retrieve testAuthor', async () => {
    // If method is reverted with the following revert reason,
    // it means the call to anteTest.testAuthor() was successful
    await expect(pool.connect(deployer).claimReward()).to.be.revertedWith('ANTE: Only author can claim');
  });
});
