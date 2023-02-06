import { oogTestFixture, OOGTestFixture } from '../fixtures/oogTest.fixture';
import { evmSnapshot, evmRevert } from '../helpers';

import hre from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider } = waffle;

import { expect } from 'chai';
import { AnteOOGDummyTest, IAntePool } from '../../typechain';

describe('CheckTest OOG Behavior', function () {
  const wallets = provider.getWallets();
  const [_, challenger] = wallets;

  let deployment: OOGTestFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let pool: IAntePool;
  let test: AnteOOGDummyTest;

  before(async () => {
    deployment = await loadFixture(oogTestFixture);
    globalSnapshotId = await evmSnapshot();
    snapshotId = await evmSnapshot();

    pool = deployment.oogTestDeployment.pool;
    test = deployment.oogTestDeployment.test as AnteOOGDummyTest;
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
  });

  it('should not fail when checkTestPasses OOGs and 1/64 of gasLimit allows tx completion', async () => {
    await test.setWillOOG(true);
    // The checkTestPasses call forwards 63/64 of remaining gas. We need a gas limit high enough such that 1/64
    // of gas which was held out is sufficient to complete the checkTest call.
    // In the case of a test failure (originally caused by an OOG revert), the post checkTest() operations have
    // have a variable cost, depending on the number of pools associated to the ante test.
    // For a single pool 181000 was found to be the amount of gas necessary to complete the checkTest() transaction when
    // checkTestPasses OOGS. The gasLimit was then derived as 181000 x 64 = 11584000. Precall gas was about 76000.
    // Rounded up to 12,000,000
    await pool.connect(challenger).checkTest({ gasLimit: 12000000 });
    expect(await pool.pendingFailure()).to.be.false;
  });
});
