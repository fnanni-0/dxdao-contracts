import * as helpers from "./helpers";
const constants = require("./helpers/constants");
const WalletScheme = artifacts.require("./WalletScheme.sol");
const PermissionRegistry = artifacts.require("./PermissionRegistry.sol");
const DaoCreator = artifacts.require("./DaoCreator.sol");
const DxControllerCreator = artifacts.require("./DxControllerCreator.sol");
const ERC20Mock = artifacts.require("./ERC20Mock.sol");
const ActionMock = artifacts.require("./ActionMock.sol");
const Wallet = artifacts.require("./Wallet.sol");

const { time } = require("@openzeppelin/test-helpers");

const WalletSchemeProposalState = {
  submitted: 0,
  rejected: 1,
  executionSuccedd: 2,
  executionFailed: 3
};

contract("WalletScheme", function(accounts) {
  
  let standardTokenMock, permissionRegistry, masterWalletScheme, quickWalletScheme, daoCreator, org, actionMock, votingMachine;
  
  const TEST_VALUE = 123;
  const TEST_HASH = helpers.SOME_HASH;
  const TEST_TITLE = "Test Title";
  
  function decodeGenericCallError(genericCallDataReturn) {
    assert.equal(genericCallDataReturn.substring(0, 10), web3.eth.abi.encodeFunctionSignature("Error(string)"));
    const errorMsgBytesLength = web3.utils.hexToNumber("0x" + genericCallDataReturn.substring(74, 138)) * 2;
    return web3.utils.hexToUtf8("0x" + genericCallDataReturn.substring(138, 138 + errorMsgBytesLength));
  }
  
  function decodeCallError(genericCallDataReturn) {
    assert.equal(genericCallDataReturn.substring(0, 10), web3.eth.abi.encodeFunctionSignature("Error(string)"));
    const errorMsgBytesLength = web3.utils.hexToNumber("0x" + genericCallDataReturn.substring(10)) * 2;
    return web3.utils.hexToUtf8("0x" + genericCallDataReturn.substring(10, 10 + errorMsgBytesLength));
  }

  
  beforeEach( async function(){
    actionMock = await ActionMock.new();
    const standardTokenMock = await ERC20Mock.new(accounts[1], 1000);
    const controllerCreator = await DxControllerCreator.new({gas: constants.ARC_GAS_LIMIT});
    daoCreator = await DaoCreator.new(
      controllerCreator.address, {gas: constants.ARC_GAS_LIMIT}
    );
    org = await helpers.setupOrganizationWithArrays(
      daoCreator,
      [accounts[0], accounts[1], accounts[2]],
      [1000, 1000, 1000],
      [20, 10, 70]
    );
    
    masterWalletScheme = await WalletScheme.new();
    permissionRegistry = await PermissionRegistry.new(accounts[0], 10);
    votingMachine = await helpers.setupGenesisProtocol(
      accounts, standardTokenMock.address, 'normal'
    );
    await masterWalletScheme.initialize(
      org.avatar.address,
      votingMachine.address,
      votingMachine.params,
      org.controller.address,
      permissionRegistry.address
    );
    
    quickWalletScheme = await WalletScheme.new();
    await quickWalletScheme.initialize(
      org.avatar.address,
      votingMachine.address,
      votingMachine.params,
      helpers.NULL_ADDRESS,
      permissionRegistry.address
    );
    
    await permissionRegistry.setAdminPermission(
      helpers.NULL_ADDRESS, 
      org.avatar.address, 
      helpers.ANY_ADDRESS, 
      helpers.ANY_FUNC_SIGNATURE,
      helpers.MAX_UINT_256, 
      true
    );
    
    await permissionRegistry.setAdminPermission(
      helpers.NULL_ADDRESS, 
      quickWalletScheme.address, 
      helpers.ANY_ADDRESS, 
      helpers.ANY_FUNC_SIGNATURE,
      helpers.MAX_UINT_256, 
      true
    );
    await daoCreator.setSchemes(
      org.avatar.address,
      [masterWalletScheme.address, quickWalletScheme.address],
      [votingMachine.params, votingMachine.params],
      [helpers.encodePermission({
        canGenericCall: true,
        canUpgrade: true,
        canChangeConstraints: true,
        canRegisterSchemes: true
      }),
      helpers.encodePermission({
        canGenericCall: false,
        canUpgrade: false,
        canChangeConstraints: false,
        canRegisterSchemes: false
      })
     ],
      "metaData"
    );
    
    await time.increase(10);

  });
  
  it.only("MasterWalletScheme - proposal with data - negative decision - proposal rejected", async function() {
    const callData = helpers.testCallFrom(org.avatar.address);
    const genericCallData = helpers.encodeGenericCallData(
      org.avatar.address, actionMock.address, callData, 0
    );
    
    let tx = await masterWalletScheme.proposeCalls(
      [org.controller.address], [genericCallData], [0], TEST_TITLE, TEST_HASH
    );
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    tx = await votingMachine.contract.vote(
      proposalId, 2, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    const executionEvent = helpers.getWalletSchemeExecutionEvent(tx);
    assert.equal(executionEvent.name, 'ProposalRejected');
    
    const organizationProposal = await masterWalletScheme.getOrganizationProposal(proposalId);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.rejected);
    assert.equal(organizationProposal.descriptionHash, TEST_HASH);
    assert.equal(organizationProposal.title, TEST_TITLE);
    assert.equal(organizationProposal.callData[0], genericCallData);
    assert.equal(organizationProposal.to[0], org.controller.address);
    assert.equal(organizationProposal.value[0], 0);
  });

  it.only("MasterWalletScheme - proposal with data - positive decision - proposal executed", async function() {
    const callData = helpers.testCallFrom(org.avatar.address);
    const genericCallData = helpers.encodeGenericCallData(
      org.avatar.address, actionMock.address, callData, 0
    );
    
    const tx = await masterWalletScheme.proposeCalls(
      [org.controller.address], [genericCallData], [0], TEST_TITLE, TEST_HASH
    );
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    await votingMachine.contract.vote(
      proposalId, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    
    const organizationProposal = await masterWalletScheme.getOrganizationProposal(proposalId);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.executionSuccedd);
    assert.equal(organizationProposal.callData[0], genericCallData);
    assert.equal(organizationProposal.to[0], org.controller.address);
    assert.equal(organizationProposal.value[0], 0);
  });
  
  it.only("MasterWalletScheme - positive decision - proposal executed - not allowed by permission registry", async function() {
    
    await permissionRegistry.setAdminPermission(
      helpers.NULL_ADDRESS, 
      org.avatar.address, 
      helpers.ANY_ADDRESS, 
      helpers.ANY_FUNC_SIGNATURE,
      helpers.MAX_UINT_256, 
      false
    );
    
    const callData = helpers.testCallFrom(org.avatar.address);
    const genericCallData = helpers.encodeGenericCallData(
      org.avatar.address, actionMock.address, callData, 0
    );
    
    const tx = await masterWalletScheme.proposeCalls(
      [org.controller.address], [genericCallData], [0], TEST_TITLE, TEST_HASH
    );
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    await votingMachine.contract.vote(
      proposalId, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
        
    const organizationProposal = await masterWalletScheme.getOrganizationProposal(proposalId);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.executionFailed);
    assert.equal(organizationProposal.callData[0], genericCallData);
    assert.equal(organizationProposal.to[0], org.controller.address);
    assert.equal(organizationProposal.value[0], 0);
  });
  
  it.only("MasterWalletScheme - positive decision - proposal executed - allowed by permission registry from scheme", async function() {
    const callData = helpers.testCallFrom(org.avatar.address);
    
    assert.notEqual(
      (await permissionRegistry.getPermission(
        helpers.NULL_ADDRESS, org.avatar.address, actionMock.address, callData.substring(0,10)
      )).fromTime.toString(),
      0
    );
    assert.notEqual(
      (await permissionRegistry.permissions(
        helpers.NULL_ADDRESS, org.avatar.address, helpers.ANY_ADDRESS, helpers.ANY_FUNC_SIGNATURE
      )).fromTime.toString(),
      0
    );
    
    await permissionRegistry.setAdminPermission(
      helpers.NULL_ADDRESS, 
      org.avatar.address, 
      helpers.ANY_ADDRESS, 
      helpers.ANY_FUNC_SIGNATURE,
      helpers.MAX_UINT_256, 
      false
    );
    
    const setPermissionData = new web3.eth.Contract(PermissionRegistry.abi).methods
      .setPermission(
        helpers.NULL_ADDRESS, actionMock.address, callData.substring(0,10), 666, true
      ).encodeABI();
    
    // Proposal to allow calling actionMock
    const tx = await masterWalletScheme.proposeCalls(
      [permissionRegistry.address], [setPermissionData], [0], TEST_TITLE, TEST_HASH
    );
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    const voteTx = await votingMachine.contract.vote(
      proposalId, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    const setPermissionTime = Number(await time.latest());

    assert.equal(
      (await permissionRegistry.getPermission(
        helpers.NULL_ADDRESS, org.avatar.address, actionMock.address, callData.substring(0,10)
      )).fromTime.toString(),
      setPermissionTime + 10
    );
    assert.equal(
      (await permissionRegistry.permissions(
        helpers.NULL_ADDRESS, org.avatar.address, helpers.ANY_ADDRESS, helpers.ANY_FUNC_SIGNATURE
      )).fromTime.toString(),
      0
    );
    
    await time.increase(10);

    const tx2 = await masterWalletScheme.proposeCalls(
      [actionMock.address], [callData], [0], TEST_TITLE, TEST_HASH
    );
    const proposalId2 = await helpers.getValueFromLogs(tx2, "_proposalId");
    await votingMachine.contract.vote(
      proposalId2, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
        
    const organizationProposal = await masterWalletScheme.getOrganizationProposal(proposalId2);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.executionSuccedd);
    assert.equal(organizationProposal.callData[0], callData);
    assert.equal(organizationProposal.to[0], actionMock.address);
    assert.equal(organizationProposal.value[0], 0);
  });
  
  it.only("MasterWalletScheme - positive decision - proposal executed with multiple calls and value", async function() {
    var wallet = await Wallet.new();
    await web3.eth.sendTransaction({
      from: accounts[0], to: org.avatar.address, value: TEST_VALUE
    });
    await wallet.transferOwnership(org.avatar.address);
    
    const payCallData = await new web3.eth.Contract(wallet.abi).methods.pay(accounts[1]).encodeABI();
    
    const tx = await masterWalletScheme.proposeCalls(
      [wallet.address, wallet.address],
      ["0x0", payCallData],
      [TEST_VALUE, 0],
      TEST_TITLE,
      helpers.NULL_HASH
    );
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    assert.equal(await web3.eth.getBalance(org.avatar.address), TEST_VALUE);
    assert.equal(await web3.eth.getBalance(wallet.address), 0);
    const balanceBeforePay = await web3.eth.getBalance(accounts[1]);

    await votingMachine.contract.vote(
      proposalId, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2], gas: 9000000}
    );
    assert.equal(await web3.eth.getBalance(org.avatar.address), 0);
    assert.equal(await web3.eth.getBalance(wallet.address), 0);
    assert.equal(await web3.eth.getBalance(accounts[1]), Number(balanceBeforePay) + TEST_VALUE);
    
    const organizationProposal = await masterWalletScheme.getOrganizationProposal(proposalId);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.executionSuccedd);
    assert.equal(organizationProposal.callData[0], "0x00");
    assert.equal(organizationProposal.to[0], wallet.address);
    assert.equal(organizationProposal.value[0], TEST_VALUE);
    assert.equal(organizationProposal.callData[1], payCallData);
    assert.equal(organizationProposal.to[1], wallet.address);
    assert.equal(organizationProposal.value[1], 0);
  });

  it.only("MasterWalletScheme - positive decision - proposal execute and show revert in return", async function() {
    const callData = helpers.testCallFrom(helpers.NULL_ADDRESS);
    
    let tx = await masterWalletScheme.proposeCalls(
      [actionMock.address], [callData], [TEST_VALUE], TEST_TITLE, TEST_HASH
    );
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    tx = await votingMachine.contract.vote(
      proposalId, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );

    const executionEvent = helpers.getWalletSchemeExecutionEvent(tx)
    const returnValue = web3.eth.abi.decodeParameters(["bool", "bytes"], 
      executionEvent.values._callsDataResult[0]);
    
    const organizationProposal = await masterWalletScheme.getOrganizationProposal(proposalId);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.executionFailed);
    assert.equal(organizationProposal.callData[0], callData);
    assert.equal(organizationProposal.to[0], actionMock.address);
    assert.equal(organizationProposal.value[0], TEST_VALUE);
  });

  it.only("MasterWalletScheme - positive decision - proposal executed without return value", async function() {
    const callData = helpers.testCallWithoutReturnValueFrom(org.avatar.address);
    
    let tx = await masterWalletScheme.proposeCalls(
      [actionMock.address], [callData], [0], TEST_TITLE, TEST_HASH
    );
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    tx = await votingMachine.contract.vote(
      proposalId, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    const executionEvent = helpers.getWalletSchemeExecutionEvent(tx)

    const returnValue = web3.eth.abi.decodeParameters(["bool", "bytes"], 
      executionEvent.values._callsDataResult[0]);
    assert.equal(returnValue["0"], true);
    assert.equal(returnValue["1"], null);
    
    const organizationProposal = await masterWalletScheme.getOrganizationProposal(proposalId);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.executionSuccedd);
    assert.equal(organizationProposal.callData[0], callData);
    assert.equal(organizationProposal.to[0], actionMock.address);
    assert.equal(organizationProposal.value[0], 0);
  });

  it.only("MasterWalletScheme - proposal with REP - execute mintReputation & burnReputation", async function() {
    const callDataMintRep = await org.controller.contract.methods.mintReputation(
      TEST_VALUE,
      accounts[4],
      org.avatar.address
    ).encodeABI();
    const callDataBurnRep = await org.controller.contract.methods.burnReputation(
      TEST_VALUE,
      accounts[4],
      org.avatar.address
    ).encodeABI();
    var tx = await masterWalletScheme.proposeCalls(
      [org.controller.address], [callDataMintRep], [0], TEST_TITLE, helpers.NULL_HASH
    );
    const proposalIdMintRep = await helpers.getValueFromLogs(tx, "_proposalId");
    tx = await masterWalletScheme.proposeCalls(
      [org.controller.address], [callDataBurnRep], [0], TEST_TITLE, helpers.NULL_HASH
    );
    const proposalIdBurnRep = await helpers.getValueFromLogs(tx, "_proposalId");

    // Mint Rep
    tx = await votingMachine.contract.vote(
      proposalIdMintRep, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    assert.equal(await org.reputation.balanceOf(accounts[4]), TEST_VALUE);

    // Burn Rep
    tx = await votingMachine.contract.vote(
      proposalIdBurnRep, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    assert.equal(await org.reputation.balanceOf(accounts[4]), 0);
  });
  
  it.only("MasterWalletScheme - proposals adding/removing schemes - execute registerScheme & removeScheme", async function() {
    const callDataRegisterScheme = await org.controller.contract.methods.registerScheme(
      helpers.SOME_ADDRESS,
      TEST_HASH,
      "0x0000000F",
      org.avatar.address
    ).encodeABI();
    const callDataRemoveScheme = await org.controller.contract.methods.unregisterScheme(
      helpers.SOME_ADDRESS,
      org.avatar.address
    ).encodeABI();
    var tx = await masterWalletScheme.proposeCalls(
      [org.controller.address], [callDataRegisterScheme], [0], TEST_TITLE, helpers.NULL_HASH
    );
    const proposalIdAddScheme = await helpers.getValueFromLogs(tx, "_proposalId");
    tx = await masterWalletScheme.proposeCalls(
      [org.controller.address], [callDataRemoveScheme], [0], TEST_TITLE, helpers.NULL_HASH
    );
    const proposalIdRemoveScheme = await helpers.getValueFromLogs(tx, "_proposalId");

    // Add Scheme
    await votingMachine.contract.vote(
      proposalIdAddScheme, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    
    const addedScheme = await org.controller.schemes(helpers.SOME_ADDRESS);
    assert.equal(addedScheme.paramsHash, TEST_HASH);
    assert.equal(addedScheme.permissions, "0x0000000f");
    
    // Remove Scheme
    await votingMachine.contract.vote(
      proposalIdRemoveScheme, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    
    const removedScheme = await org.controller.schemes(helpers.SOME_ADDRESS);
    assert.equal(removedScheme.paramsHash, helpers.NULL_HASH);
    assert.equal(removedScheme.permissions, "0x00000000");
  });

  it.only("MasterWalletScheme - execute should fail if not passed/executed from votingMachine", async function() {
    const callData = helpers.testCallFrom(org.avatar.address);
    var tx = await masterWalletScheme.proposeCalls(
      [actionMock.address], [callData], [0], TEST_TITLE, helpers.NULL_HASH
    );
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    await votingMachine.contract.execute(proposalId);
    const organizationProposal = await masterWalletScheme.getOrganizationProposal(proposalId);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.submitted);
  });
  
  it.only("MasterWalletScheme - positive decision - proposal executed with transfer, pay and mint rep", async function() {
    var wallet = await Wallet.new();
    await web3.eth.sendTransaction({
      from: accounts[0], to: org.avatar.address, value: TEST_VALUE
    });
    await wallet.transferOwnership(org.avatar.address);
    
    const genericCallDataTransfer = helpers.encodeGenericCallData(
      org.avatar.address, wallet.address, "0x0", TEST_VALUE
    );
    const payCallData = await new web3.eth.Contract(wallet.abi).methods.pay(accounts[1]).encodeABI();
    const genericCallDataPay = helpers.encodeGenericCallData(
      org.avatar.address, wallet.address, payCallData, 0
    );
    const callDataMintRep = await org.controller.contract.methods.mintReputation(
      TEST_VALUE,
      accounts[4],
      org.avatar.address
    ).encodeABI();
    
    const tx = await masterWalletScheme.proposeCalls(
      [wallet.address, wallet.address, org.controller.address],
      ["0x0", payCallData, callDataMintRep],
      [TEST_VALUE, 0, 0],
      TEST_TITLE,
      TEST_HASH
    );
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    assert.equal(await web3.eth.getBalance(org.avatar.address), TEST_VALUE);
    assert.equal(await web3.eth.getBalance(wallet.address), 0);
    assert.equal(await org.reputation.balanceOf(accounts[4]), 0);

    const balanceBeforePay = await web3.eth.getBalance(accounts[1]);
    await votingMachine.contract.vote(
      proposalId, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    assert.equal(await web3.eth.getBalance(org.avatar.address), 0);
    assert.equal(await web3.eth.getBalance(wallet.address), 0);
    assert.equal(await web3.eth.getBalance(accounts[1]), Number(balanceBeforePay) + TEST_VALUE);
    assert.equal(await org.reputation.balanceOf(accounts[4]), TEST_VALUE);
    
    const organizationProposal = await masterWalletScheme.getOrganizationProposal(proposalId);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.executionSuccedd);
    assert.equal(organizationProposal.descriptionHash, TEST_HASH);
    assert.equal(organizationProposal.callData[0], "0x00");
    assert.equal(organizationProposal.to[0], wallet.address);
    assert.equal(organizationProposal.value[0], TEST_VALUE);
    assert.equal(organizationProposal.callData[1], payCallData);
    assert.equal(organizationProposal.to[1], wallet.address);
    assert.equal(organizationProposal.value[1], 0);
    assert.equal(organizationProposal.callData[2], callDataMintRep);
    assert.equal(organizationProposal.to[2], org.controller.address);
    assert.equal(organizationProposal.value[2], 0);
  });
  
  it.only("MasterWalletScheme - cannot initialize twice", async function() {
    try {
      await masterWalletScheme.initialize(
        org.avatar.address,
        accounts[0],
        accounts[0],
        helpers.NULL_ADDRESS,
        permissionRegistry.address
      );
      assert(false, "cannot init twice");
    } catch(error) {
      helpers.assertVMException(error);
    }
  });

  it.only("QuickWalletScheme - proposal with data - negative decision - proposal rejected", async function() {
    const callData = helpers.testCallFrom(quickWalletScheme.address);
    
    let tx = await quickWalletScheme.proposeCalls(
      [actionMock.address], [callData], [0], TEST_TITLE, TEST_HASH
    );
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    tx = await votingMachine.contract.vote(
      proposalId, 2, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    const executionEvent = helpers.getWalletSchemeExecutionEvent(tx);
    assert.equal(executionEvent.name, 'ProposalRejected');
    
    const organizationProposal = await quickWalletScheme.getOrganizationProposal(proposalId);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.rejected);
    assert.equal(organizationProposal.callData[0], callData);
    assert.equal(organizationProposal.to[0], actionMock.address);
    assert.equal(organizationProposal.value[0], 0);
  });

  it.only("QuickWalletScheme - proposal with data - positive decision - proposal executed", async function() {
    const callData = helpers.testCallFrom(quickWalletScheme.address);
    
    const tx = await quickWalletScheme.proposeCalls(
      [actionMock.address], [callData], [0], TEST_TITLE, TEST_HASH
    );
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    await votingMachine.contract.vote(
      proposalId, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    
    const organizationProposal = await quickWalletScheme.getOrganizationProposal(proposalId);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.executionSuccedd);
    assert.equal(organizationProposal.callData[0], callData);
    assert.equal(organizationProposal.to[0], actionMock.address);
    assert.equal(organizationProposal.value[0], 0);
  });
  
  it.only("QuickWalletScheme - proposal with data - positive decision - proposal executed with multiple calls and value", async function() {
    var wallet = await Wallet.new();
    await web3.eth.sendTransaction({
      from: accounts[0], to: quickWalletScheme.address, value: TEST_VALUE
    });
    await wallet.transferOwnership(quickWalletScheme.address);
    
    const payCallData = await new web3.eth.Contract(wallet.abi).methods.pay(accounts[1]).encodeABI();
    
    const tx = await quickWalletScheme.proposeCalls(
      [wallet.address, wallet.address],
      ["0x0", payCallData],
      [TEST_VALUE, 0],
      TEST_TITLE,
      helpers.NULL_HASH
    );true;
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    assert.equal(await web3.eth.getBalance(quickWalletScheme.address), TEST_VALUE);
    assert.equal(await web3.eth.getBalance(wallet.address), 0);
    const balanceBeforePay = await web3.eth.getBalance(accounts[1]);
    await votingMachine.contract.vote(
      proposalId, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    assert.equal(await web3.eth.getBalance(quickWalletScheme.address), 0);
    assert.equal(await web3.eth.getBalance(wallet.address), 0);
    assert.equal(await web3.eth.getBalance(accounts[1]), Number(balanceBeforePay) + TEST_VALUE);
    
    const organizationProposal = await quickWalletScheme.getOrganizationProposal(proposalId);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.executionSuccedd);
    assert.equal(organizationProposal.callData[0], "0x00");
    assert.equal(organizationProposal.to[0], wallet.address);
    assert.equal(organizationProposal.value[0], TEST_VALUE);
    assert.equal(organizationProposal.callData[1], payCallData);
    assert.equal(organizationProposal.to[1], wallet.address);
    assert.equal(organizationProposal.value[1], 0);
  });

  it.only("QuickWalletScheme - proposal with data - positive decision - proposal execute and show revert in return", async function() {
    const callData = helpers.testCallFrom(helpers.NULL_ADDRESS);
    
    let tx = await quickWalletScheme.proposeCalls(
      [actionMock.address], [callData], [0], TEST_TITLE, TEST_HASH
    );
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    tx = await votingMachine.contract.vote(
      proposalId, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2], gas: 600000}
    );
    const executionEvent = helpers.getWalletSchemeExecutionEvent(tx)
    assert.equal(
      decodeGenericCallError(executionEvent.values._callsDataResult[0]),
      "the caller must be equal to _addr"
    );
    
    const organizationProposal = await quickWalletScheme.getOrganizationProposal(proposalId);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.executionFailed);
    assert.equal(organizationProposal.callData[0], callData);
    assert.equal(organizationProposal.to[0], actionMock.address);
    assert.equal(organizationProposal.value[0], 0);
  });

  it.only("QuickWalletScheme - proposal with data - positive decision - proposal executed without return value", async function() {
    const callData = helpers.testCallWithoutReturnValueFrom(quickWalletScheme.address);
    
    let tx = await quickWalletScheme.proposeCalls(
      [actionMock.address], [callData], [0], TEST_TITLE, TEST_HASH
    );
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    tx = await votingMachine.contract.vote(
      proposalId, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    const executionEvent = helpers.getWalletSchemeExecutionEvent(tx)

    const returnValues = executionEvent.values._callsDataResult[0];
    assert.equal(returnValues, "0x");
    
    const organizationProposal = await quickWalletScheme.getOrganizationProposal(proposalId);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.executionSuccedd);
    assert.equal(organizationProposal.callData[0], callData);
    assert.equal(organizationProposal.to[0], actionMock.address);
    assert.equal(organizationProposal.value[0], 0);
  });
  
  it.only("QuickWalletScheme - proposal with REP - execute mintReputation & burnReputation", async function() {
    const callDataMintRep = await org.controller.contract.methods.mintReputation(
      TEST_VALUE,
      accounts[4],
      org.avatar.address
    ).encodeABI();
    const callDataBurnRep = await org.controller.contract.methods.burnReputation(
      TEST_VALUE,
      accounts[4],
      org.avatar.address
    ).encodeABI();
    var tx = await quickWalletScheme.proposeCalls(
      [org.controller.address], [callDataMintRep], [0], TEST_TITLE, helpers.NULL_HASH
    );
    const proposalIdMintRep = await helpers.getValueFromLogs(tx, "_proposalId");
    tx = await quickWalletScheme.proposeCalls(
      [org.controller.address], [callDataBurnRep], [0], TEST_TITLE, helpers.NULL_HASH
    );
    const proposalIdBurnRep = await helpers.getValueFromLogs(tx, "_proposalId");

    // Mint Rep
    await votingMachine.contract.vote(
      proposalIdMintRep, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    assert.equal(await org.reputation.balanceOf(accounts[4]), TEST_VALUE);

    // Burn Rep
    await votingMachine.contract.vote(
      proposalIdBurnRep, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    assert.equal(await org.reputation.balanceOf(accounts[4]), 0);
  });
  
  it.only("QuickWalletScheme - proposals adding/removing schemes - should fail on registerScheme & removeScheme", async function() {
    const callDataRegisterScheme = await org.controller.contract.methods.registerScheme(
      helpers.SOME_ADDRESS,
      TEST_HASH,
      "0x0000000F",
      org.avatar.address
    ).encodeABI();
    const callDataRemoveScheme = await org.controller.contract.methods.unregisterScheme(
      masterWalletScheme.address,
      org.avatar.address
    ).encodeABI();
    var tx = await quickWalletScheme.proposeCalls(
      [org.controller.address], [callDataRegisterScheme], [0], TEST_TITLE, helpers.NULL_HASH
    );
    const proposalIdAddScheme = await helpers.getValueFromLogs(tx, "_proposalId");
    tx = await quickWalletScheme.proposeCalls(
      [org.controller.address], [callDataRemoveScheme], [0], TEST_TITLE, helpers.NULL_HASH
    );
    const proposalIdRemoveScheme = await helpers.getValueFromLogs(tx, "_proposalId");

    // Add Scheme
    tx = await votingMachine.contract.vote(
      proposalIdAddScheme, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    const addedScheme = await org.controller.schemes(helpers.SOME_ADDRESS);
    assert.equal(addedScheme.paramsHash, "0x0000000000000000000000000000000000000000000000000000000000000000");
    assert.equal(addedScheme.permissions, "0x00000000");
    
    // Remove Scheme
    await votingMachine.contract.vote(
      proposalIdRemoveScheme, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    
    const removedScheme = await org.controller.schemes(masterWalletScheme.address);
    assert.equal(removedScheme.paramsHash, votingMachine.params);
    assert.equal(removedScheme.permissions, "0x0000001f");
  });
  
  it.only("QuickWalletScheme - positive decision - proposal executed - allowed by permission registry from scheme", async function() {
    const callData = helpers.testCallFrom(quickWalletScheme.address);
    
    assert.notEqual(
      (await permissionRegistry.getPermission(
        helpers.NULL_ADDRESS, quickWalletScheme.address, actionMock.address, callData.substring(0,10)
      )).fromTime.toString(),
      0
    );
    assert.notEqual(
      (await permissionRegistry.permissions(
        helpers.NULL_ADDRESS, quickWalletScheme.address, helpers.ANY_ADDRESS, helpers.ANY_FUNC_SIGNATURE
      )).fromTime.toString(),
      0
    );
    
    await permissionRegistry.setAdminPermission(
      helpers.NULL_ADDRESS, 
      quickWalletScheme.address, 
      helpers.ANY_ADDRESS, 
      helpers.ANY_FUNC_SIGNATURE,
      helpers.MAX_UINT_256, 
      false
    );
    
    assert.equal(
      (await permissionRegistry.getPermission(
        helpers.NULL_ADDRESS, quickWalletScheme.address, actionMock.address, callData.substring(0,10)
      )).fromTime.toString(),
      0
    );
    assert.equal(
      (await permissionRegistry.permissions(
        helpers.NULL_ADDRESS, quickWalletScheme.address, helpers.ANY_ADDRESS, helpers.ANY_FUNC_SIGNATURE
      )).fromTime.toString(),
      0
    );
    
    const setPermissionData = new web3.eth.Contract(PermissionRegistry.abi).methods
      .setPermission(
        helpers.NULL_ADDRESS, helpers.ANY_ADDRESS, helpers.ANY_FUNC_SIGNATURE, helpers.MAX_UINT_256, true
      ).encodeABI();
        
    // Proposal to allow calling actionMock
    const tx = await quickWalletScheme.proposeCalls(
      [permissionRegistry.address], [setPermissionData], [0], TEST_TITLE, TEST_HASH
    );
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    const voteTx = await votingMachine.contract.vote(
      proposalId, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    const setPermissionTime = Number(await time.latest());
    
    assert.equal(
      (await permissionRegistry.getPermission(
        helpers.NULL_ADDRESS, quickWalletScheme.address, actionMock.address, callData.substring(0,10)
      )).fromTime.toString(),
      setPermissionTime + 10
    );
    assert.equal(
      (await permissionRegistry.permissions(
        helpers.NULL_ADDRESS, quickWalletScheme.address, helpers.ANY_ADDRESS, helpers.ANY_FUNC_SIGNATURE
      )).fromTime.toString(),
      setPermissionTime + 10
    );
    
    await time.increase(10);

    const tx2 = await quickWalletScheme.proposeCalls(
      [actionMock.address], [callData], [0], TEST_TITLE, TEST_HASH
    );
    const proposalId2 = await helpers.getValueFromLogs(tx2, "_proposalId");
    await votingMachine.contract.vote(
      proposalId2, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
        
    const organizationProposal = await quickWalletScheme.getOrganizationProposal(proposalId2);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.executionSuccedd);
    assert.equal(organizationProposal.callData[0], callData);
    assert.equal(organizationProposal.to[0], actionMock.address);
    assert.equal(organizationProposal.value[0], 0);
  });
  
  it.only("QuickWalletScheme - positive decision - proposal executed with transfer, pay and mint rep", async function() {
    var wallet = await Wallet.new();
    await web3.eth.sendTransaction({
      from: accounts[0], to: quickWalletScheme.address, value: 100000000
    });
    await wallet.transferOwnership(quickWalletScheme.address);
    
    const payCallData = await new web3.eth.Contract(wallet.abi).methods.pay(accounts[1]).encodeABI();
    const callDataMintRep = await org.controller.contract.methods.mintReputation(
      TEST_VALUE,
      accounts[4],
      org.avatar.address
    ).encodeABI();
    
    let tx = await quickWalletScheme.proposeCalls(
      [wallet.address, wallet.address, org.controller.address],
      ["0x0", payCallData, callDataMintRep],
      [TEST_VALUE, 0, 0],
      TEST_TITLE,
      TEST_HASH
    );
    const proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    assert.equal(await web3.eth.getBalance(quickWalletScheme.address), 100000000);
    assert.equal(await web3.eth.getBalance(wallet.address), 0);
    assert.equal(await org.reputation.balanceOf(accounts[4]), 0);

    const balanceBeforePay = await web3.eth.getBalance(accounts[1]);
    tx = await votingMachine.contract.vote(
      proposalId, 1, 0, helpers.NULL_ADDRESS, {from: accounts[2]}
    );
    const executionEvent = helpers.getWalletSchemeExecutionEvent(tx)
    assert.equal(executionEvent.values._callsSucessResult[0], true);
    assert.equal(executionEvent.values._callsSucessResult[1], true);
    assert.equal(executionEvent.values._callsSucessResult[2], true);
    assert.equal(executionEvent.values._callsDataResult[0], "0x");
    assert.equal(executionEvent.values._callsDataResult[1], "0x");
    assert.equal(
      executionEvent.values._callsDataResult[2], 
      "0x0000000000000000000000000000000000000000000000000000000000000001"
    );
    
    assert.equal(await web3.eth.getBalance(org.avatar.address), 0);
    assert.equal(await web3.eth.getBalance(wallet.address), 0);
    assert.equal(await web3.eth.getBalance(accounts[1]), Number(balanceBeforePay) + TEST_VALUE);
    assert.equal(await org.reputation.balanceOf(accounts[4]), TEST_VALUE);
    
    const organizationProposal = await quickWalletScheme.getOrganizationProposal(proposalId);
    assert.equal(organizationProposal.state, WalletSchemeProposalState.executionSuccedd);
    assert.equal(organizationProposal.callData[0], "0x00");
    assert.equal(organizationProposal.to[0], wallet.address);
    assert.equal(organizationProposal.value[0], TEST_VALUE);
    assert.equal(organizationProposal.callData[1], payCallData);
    assert.equal(organizationProposal.to[1], wallet.address);
    assert.equal(organizationProposal.value[1], 0);
    assert.equal(organizationProposal.callData[2], callDataMintRep);
    assert.equal(organizationProposal.to[2], org.controller.address);
    assert.equal(organizationProposal.value[2], 0);
  });
  
});
