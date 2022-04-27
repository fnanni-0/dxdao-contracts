/* eslint-disable no-case-declarations */
require("@nomiclabs/hardhat-web3");
// const hre = require("hardhat");

const { deployTokens } = require("./utils/deploy-tokens");
const moment = require("moment");
const { default: BigNumber } = require("bignumber.js");
const { deployGuilds } = require("./utils/deploy-guilds");

// const ERC20Guild = hre.artifacts.require("ERC20Guild");

// const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
// const ANY_ADDRESS = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
// // const MAX_UINT_256 =
// //   "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
// const ANY_FUNC_SIGNATURE = "0xaaaaaaaa";
// const web3 = hre.web3;

task("deploy-guilds", "Deploy guilds")
  .addParam("deployconfig", "The deploy config json in string format")
  .setAction(async ({ deployconfig }) => {
    const GuildRegistry = await hre.artifacts.require("GuildRegistry");

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    let addresses = {};

    // Parse string json config to json object
    const deploymentConfig = JSON.parse(deployconfig);

    // Import contracts
    const PermissionRegistry = await hre.artifacts.require(
      "PermissionRegistry"
    );

    async function waitBlocks(blocks) {
      const toBlock = (await web3.eth.getBlock("latest")).number + blocks;
      while ((await web3.eth.getBlock("latest")).number < toBlock) {
        await sleep(500);
      }
      return;
    }

    // Get ETH accounts to be used
    const accounts = await web3.eth.getAccounts();

    // Get fromBlock for network contracts
    const fromBlock = (await web3.eth.getBlock("latest")).number;

    // Set networkContracts object that will store the contracts deployed
    let networkContracts = {
      fromBlock: fromBlock,
      avatar: null,
      reputation: null,
      token: null,
      controller: null,
      permissionRegistry: null,
      schemes: {},
      utils: {},
      votingMachines: {},
    };

    // Deploy Tokens
    const { tokens, addresses: tokenAddresses } = await deployTokens(
      deploymentConfig,
      accounts
    );

    addresses = Object.assign(addresses, tokenAddresses);

    // Deploy PermissionRegistry to be used by WalletSchemes
    let permissionRegistry;
    console.log("Deploying PermissionRegistry...");
    permissionRegistry = await PermissionRegistry.new();
    await permissionRegistry.initialize();
    addresses["PermissionRegistry"] = permissionRegistry.address;

    console.log("Permission Registry deployed to:", permissionRegistry.address);
    networkContracts.permissionRegistry = permissionRegistry.address;
    addresses["PermissionRegstry"] = permissionRegistry.address;
    await waitBlocks(1);
    console.log(deploymentConfig.guildRegistry);
    // Deploy Guilds
    await deployGuilds(
      deploymentConfig,
      tokens,
      await GuildRegistry.at(deploymentConfig.guildRegistry)
    );

    // Increase time to local time
    await hre.network.provider.request({
      method: "evm_increaseTime",
      params: [moment().unix() - (await web3.eth.getBlock("latest")).timestamp],
    });

    return { networkContracts, addresses };
  });

module.exports = {};
