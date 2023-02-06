import { evmSnapshot, evmRevert } from '../helpers';
import AntePoolFactoryControllerArtifact from '../../artifacts/contracts/AntePoolFactoryController.sol/AntePoolFactoryController.json';

import hre from 'hardhat';
const { waffle } = hre;
const { provider, deployContract } = waffle;

import { expect } from 'chai';
import { AntePoolFactoryController } from '../../typechain/AntePoolFactoryController';
import { ONE_ETH, TOKENS } from '../constants';

describe('Ante Pool Factory Controller', function () {
  const wallets = provider.getWallets();
  const [deployer] = wallets;

  let snapshotId: string;
  let globalSnapshotId: string;
  let poolFactoryController: AntePoolFactoryController;

  before(async () => {
    poolFactoryController = (await deployContract(
      deployer,
      AntePoolFactoryControllerArtifact
    )) as AntePoolFactoryController;
    await poolFactoryController.deployed();

    globalSnapshotId = await evmSnapshot();
    snapshotId = await evmSnapshot();
  });

  after(async () => {
    await evmRevert(globalSnapshotId);
  });

  beforeEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
  });

  describe('addToken', () => {
    it('adds a token address to the allowed list', async () => {
      expect(await poolFactoryController.isTokenAllowed(TOKENS.WBTC)).to.equal(false);

      await expect(poolFactoryController.addToken(TOKENS.WBTC, ONE_ETH))
        .to.emit(poolFactoryController, 'TokenAdded')
        .withArgs(TOKENS.WBTC, ONE_ETH);

      expect(await poolFactoryController.isTokenAllowed(TOKENS.WBTC)).to.equal(true);
      expect(await poolFactoryController.getTokenMinimum(TOKENS.WBTC)).to.equal(ONE_ETH);
    });

    it('reverts if token already exists', async () => {
      await poolFactoryController.addToken(TOKENS.WBTC, ONE_ETH);

      await expect(poolFactoryController.addToken(TOKENS.WBTC, ONE_ETH)).to.be.revertedWith(
        'ANTE: Token already exists'
      );
    });

    it('reverts if token minimum is 0', async () => {
      await expect(poolFactoryController.addToken(TOKENS.WBTC, 0)).to.be.revertedWith(
        'ANTE: Minimum must be greater than 0'
      );
    });
  });

  describe('setTokenMinimum', () => {
    it('modifies the token minimum', async () => {
      await poolFactoryController.addToken(TOKENS.WBTC, ONE_ETH);

      const newMinimum = 999999;
      expect(await poolFactoryController.getTokenMinimum(TOKENS.WBTC)).to.equal(ONE_ETH);
      await poolFactoryController.setTokenMinimum(TOKENS.WBTC, newMinimum);
      expect(await poolFactoryController.getTokenMinimum(TOKENS.WBTC)).to.equal(newMinimum);

      await poolFactoryController.setTokenMinimum(TOKENS.WBTC, newMinimum * 2);
      expect(await poolFactoryController.getTokenMinimum(TOKENS.WBTC)).to.equal(newMinimum * 2);
    });

    it('reverts if token is not in the allow list', async () => {
      await expect(poolFactoryController.setTokenMinimum(TOKENS.WBTC, 123456)).to.be.revertedWith(
        'ANTE: Token not supported'
      );
    });

    it('emits TokenMinimumUpdated', async () => {
      await poolFactoryController.addToken(TOKENS.WBTC, ONE_ETH);

      const newMinimum = 999999;
      await expect(poolFactoryController.setTokenMinimum(TOKENS.WBTC, newMinimum))
        .to.emit(poolFactoryController, 'TokenMinimumUpdated')
        .withArgs(TOKENS.WBTC, newMinimum);
    });
  });

  describe('getTokenMinimum', () => {
    it('retrieves the token minimum for a given ERC20 token', async () => {
      const newMinimum = 123456;
      await poolFactoryController.addToken(TOKENS.WBTC, ONE_ETH);
      await poolFactoryController.setTokenMinimum(TOKENS.WBTC, newMinimum);
      expect(await poolFactoryController.getTokenMinimum(TOKENS.WBTC)).to.equal(newMinimum);
    });

    it('reverts if token is not in the allow list', async () => {
      await expect(poolFactoryController.getTokenMinimum(TOKENS.WBTC)).to.be.revertedWith('ANTE: Token not supported');
    });
  });

  describe('removeToken', () => {
    it('removes a token address from the allowed list', async () => {
      await poolFactoryController.addToken(TOKENS.WBTC, ONE_ETH);

      expect(await poolFactoryController.isTokenAllowed(TOKENS.WBTC)).to.equal(true);

      await poolFactoryController.removeToken(TOKENS.WBTC);

      expect(await poolFactoryController.isTokenAllowed(TOKENS.WBTC)).to.equal(false);
    });

    it('reverts if token does not exist', async () => {
      expect(await poolFactoryController.isTokenAllowed(TOKENS.WBTC)).to.be.equal(false);

      await expect(poolFactoryController.removeToken(TOKENS.WBTC)).to.be.revertedWith('ANTE: Token does not exist');
    });

    it('emits TokenRemoved', async () => {
      await poolFactoryController.addToken(TOKENS.WBTC, ONE_ETH);

      await expect(poolFactoryController.removeToken(TOKENS.WBTC))
        .to.emit(poolFactoryController, 'TokenRemoved')
        .withArgs(TOKENS.WBTC);
    });
  });

  describe('getAlllowedTokens', () => {
    it('returns an array of all the allowed addresses', async () => {
      const tokens = [TOKENS.WBTC, TOKENS.USDC];

      for (const token of tokens) {
        await poolFactoryController.addToken(token, ONE_ETH);
      }

      expect(await poolFactoryController.getAllowedTokens()).to.deep.equal(tokens);
    });
  });

  describe('addTokens', () => {
    it('adds all provided tokens to the allowed list', async () => {
      const tokens = [TOKENS.WBTC, TOKENS.USDC];
      const mins = [ONE_ETH, 10 ** 6];

      const tx = await poolFactoryController.addTokens(tokens, mins);
      const receipt = await tx.wait();

      const events = receipt.events?.filter((event) => event.event === 'TokenAdded') ?? [];
      expect(events?.length).to.be.equal(tokens.length);

      expect(await poolFactoryController.getAllowedTokens()).to.deep.equal(tokens);
      expect(await poolFactoryController.getTokenMinimum(tokens[0])).to.be.equal(mins[0]);
      expect(await poolFactoryController.getTokenMinimum(tokens[1])).to.be.equal(mins[1]);
    });

    it('reverts if some of the provided tokens already exist', async () => {
      const tokens = [TOKENS.WBTC, TOKENS.USDC];
      const mins = [ONE_ETH, 10 ** 6];

      await poolFactoryController.addToken(tokens[0], ONE_ETH.div(2));

      expect(await poolFactoryController.getAllowedTokens()).to.deep.equal([tokens[0]]);

      await expect(poolFactoryController.addTokens(tokens, mins)).to.be.revertedWith('ANTE: Token already exist');
    });

    it('reverts if all the provided tokens already exist', async () => {
      const tokens = [TOKENS.WBTC, TOKENS.USDC];
      const mins = [ONE_ETH, 10 ** 6];

      await poolFactoryController.addTokens(tokens, mins);

      await expect(poolFactoryController.addTokens(tokens, mins)).to.be.revertedWith('ANTE: Token already exist');
    });

    it('reverts if token minimum is not provided for all tokens', async () => {
      const tokens = [TOKENS.WBTC, TOKENS.USDC];
      const mins = [ONE_ETH];

      await expect(poolFactoryController.addTokens(tokens, mins)).to.be.revertedWith('ANTE: Minimum is not set');
    });

    it('reverts if one of token minimums is 0', async () => {
      const tokens = [TOKENS.WBTC, TOKENS.USDC];
      const mins = [ONE_ETH, 0];

      await expect(poolFactoryController.addTokens(tokens, mins)).to.be.revertedWith(
        'ANTE: Minimum must be greater than 0'
      );
    });
  });

  describe('setLogicAddress', () => {
    it('emits AntePoolImplementationUpdated', async () => {
      const oldPoolLogicAddress = await poolFactoryController.antePoolLogicAddr();
      await expect(poolFactoryController.setPoolLogicAddr(deployer.address))
        .to.be.emit(poolFactoryController, 'AntePoolImplementationUpdated')
        .withArgs(oldPoolLogicAddress, deployer.address);
    });

    it('changes implementation address', async () => {
      await poolFactoryController.setPoolLogicAddr(deployer.address);
      expect(await poolFactoryController.antePoolLogicAddr()).to.be.eq(deployer.address);
    });
  });
});
