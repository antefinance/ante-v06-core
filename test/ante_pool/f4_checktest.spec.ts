import {
  evmSnapshot,
  evmRevert,
  blockNumber,
  getExpectedChallengerPayoutWithoutBounty,
  evmIncreaseTime,
  givePoolAllowance,
  evmMineBlocks,
  deployPool,
} from '../helpers';
import * as constants from '../constants';

import hre from 'hardhat';
const { waffle } = hre;
const { loadFixture, provider } = waffle;

import { expect } from 'chai';
import { AnteConditionalTest, AnteERC20, AnteStateTest, IAntePool } from '../../typechain';
import { defaultAbiCoder, hexZeroPad } from 'ethers/lib/utils';
import { antePoolTestFixture, AntePoolTestFixture } from '../fixtures/antePoolTest.fixture';

describe('CheckTest', function () {
  const wallets = provider.getWallets();
  const [_1, _2, staker, challenger, staker2, challenger2, challenger3] = wallets;

  let deployment: AntePoolTestFixture;
  let snapshotId: string;
  let globalSnapshotId: string;
  let pool: IAntePool;
  let test: AnteConditionalTest;
  let token: AnteERC20;
  let stateTestTest: AnteStateTest;

  before(async () => {
    deployment = await loadFixture(antePoolTestFixture);
    globalSnapshotId = await evmSnapshot();
    snapshotId = await evmSnapshot();

    pool = deployment.conditionalTestDeployment.pool;
    test = deployment.conditionalTestDeployment.test;
    token = deployment.token;
    stateTestTest = deployment.stateTestDeployment.test;
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
  });

  describe('checkTest', () => {
    it('should not update pendingFailure to true if test is passing ', async () => {
      expect(await test.checkTestPasses()).to.be.true;
      await pool.connect(challenger).checkTest();

      expect(await pool.pendingFailure()).to.be.false;
    });

    it('reverts if called within 12 blocks of staking', async () => {
      await pool.connect(challenger3).registerChallenge(constants.ONE_ETH.div(10));
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await pool.connect(challenger3).confirmChallenge();

      await expect(pool.connect(challenger3).checkTest()).to.be.revertedWith(
        'ANTE: must wait 12 blocks after challenging to call checkTest'
      );
    });

    it('reverts if address which is not challenging calls checkTest', async () => {
      await expect(pool.connect(staker).checkTest()).to.be.revertedWith(
        'ANTE: Only confirmed challengers can checkTest'
      );
    });

    it('updates lastVerifiedBlock and numTimesVerified', async () => {
      const numTimesVerified = await pool.numTimesVerified();

      await pool.connect(challenger).checkTest();

      expect(await pool.lastVerifiedBlock()).to.equal(await blockNumber());
      expect(await pool.numTimesVerified()).to.equal(numTimesVerified.add(1));
    });

    it('sets pendingFailure to true if underlying ante test reverts on checkTestPasses', async () => {
      await test.setWillFail(true);

      await pool.connect(challenger).checkTest();
      expect(await pool.pendingFailure()).to.be.true;
    });

    it('emits TestChecked and FailureOccured events with correct arguments', async () => {
      await expect(pool.connect(challenger).checkTest()).to.emit(pool, 'TestChecked').withArgs(challenger.address);

      await test.setWillFail(true);

      await expect(pool.connect(challenger).checkTest()).to.emit(pool, 'FailureOccurred').withArgs(challenger.address);
    });

    it('fails all the other pools associated with the same test', async () => {
      const pools = [];

      for (let i = 0; i < 6; i++) {
        const contract = await deployPool(deployment.poolFactory, test.address, {
          tokenAddress: token.address,
          testAuthorRewardRate: i,
        });

        // Stake something in each pool so challengers can have funds to claim
        await givePoolAllowance(contract, token, [staker, challenger]);
        await contract.connect(staker).stake(constants.ONE_ETH.mul(5), constants.MIN_STAKE_COMMITMENT);

        pools.push(contract);
      }

      const [challengedPool1, challengedPool2, ...restPools] = pools;

      await challengedPool1.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await challengedPool1.connect(challenger).confirmChallenge();

      await challengedPool2.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await challengedPool2.connect(challenger).confirmChallenge();

      await test.setWillFail(true);

      // Must wait 12 blocks before checkTest
      await evmMineBlocks(12);
      const tx = await challengedPool1.connect(challenger).checkTest();
      const receipt = await tx.wait();

      const failureEvents = receipt.events?.filter((event) => event.event === 'FailureOccurred') ?? [];
      // Check that all pools have failed.
      // There is one extra pool coming from fixture
      expect(failureEvents?.length).to.be.equal(pools.length + 1);

      for (const failureEvent of failureEvents) {
        expect(failureEvent.args?.[0]).to.be.equal(challenger.address);
      }

      for (const pool of pools) {
        expect(await pool.pendingFailure()).to.be.true;
      }

      for (const pool of restPools) {
        await expect(pool.connect(challenger).claim()).to.be.revertedWith('ANTE: No Challenger Staking balance');
      }

      const expectedPayout1 = await getExpectedChallengerPayoutWithoutBounty(challenger, challengedPool1);
      const expectedPayout2 = await getExpectedChallengerPayoutWithoutBounty(challenger, challengedPool2);

      const balanceBeforePayout = await token.balanceOf(challenger.address);
      const bounty1 = await challengedPool1.getVerifierBounty();
      const bounty2 = await challengedPool2.getVerifierBounty();

      await challengedPool1.connect(challenger).claim();
      await challengedPool2.connect(challenger).claim();

      expect(await token.balanceOf(challenger.address)).to.be.equal(
        balanceBeforePayout.add(expectedPayout1).add(bounty1).add(expectedPayout2).add(bounty2)
      );
    });

    it('does not allow reentrancy', async () => {
      const reenteringContract = deployment.reenteringContract;
      const reenteringPool = deployment.reenteringTestDeployment.pool;
      const reenteringTest = deployment.reenteringTestDeployment.test;

      await reenteringTest.setAntePool(reenteringPool.address);

      await reenteringContract.connect(challenger).registerChallenge(constants.ONE_ETH.div(10));
      await evmMineBlocks(12);

      await evmIncreaseTime(constants.CHALLENGER_TIMESTAMP_DELAY);
      await reenteringPool.connect(challenger).confirmChallenge();

      await reenteringTest.setWillReenter(true);
      await reenteringPool.connect(challenger).checkTest();

      expect(await reenteringContract.reentrancySuccess()).to.be.false;
    });

    it('reverts for unconfirmed challengers', async () => {
      await pool.connect(challenger3).registerChallenge(constants.ONE_ETH.div(10));
      await expect(pool.connect(challenger3).checkTest()).to.be.revertedWith(
        'ANTE: Only confirmed challengers can checkTest'
      );
    });
  });

  describe('checkTestWithState', () => {
    it('should pass the state to the checked Ante Test', async () => {
      expect(await stateTestTest.uintValue()).to.be.equal(0);
      const uintValue = 12;

      const state = defaultAbiCoder.encode(
        ['uint256', 'address[]', 'string', 'bytes32'],
        [uintValue, [], '', hexZeroPad('0x', 32)]
      );

      await deployment.stateTestDeployment.pool.connect(challenger).checkTestWithState(state);

      expect(await stateTestTest.uintValue()).to.be.equal(uintValue);
    });
  });

  describe('claim', () => {
    it('reverts if test has not failed', async () => {
      await expect(pool.connect(challenger).claim()).to.be.revertedWith('ANTE: Test has not failed');
    });

    it('does not transfer tokens out of pool before test failure', async () => {
      const pool_balance = await provider.getBalance(pool.address);
      const pool_token_balance = await token.balanceOf(pool.address);
      await expect(pool.connect(challenger).claim()).to.be.reverted;

      expect(await provider.getBalance(pool.address)).to.equal(pool_balance);
      expect(await token.balanceOf(pool.address)).to.equal(pool_token_balance);
    });
  });

  describe('getChallengerPayout', () => {
    it('estimates the challenger payout correctly prior to test failure', async () => {
      await pool.updateDecay();
      const expectedPayout = await getExpectedChallengerPayoutWithoutBounty(challenger, pool);
      expect(await pool.getChallengerPayout(challenger.address)).to.equal(expectedPayout);
    });
  });
});
