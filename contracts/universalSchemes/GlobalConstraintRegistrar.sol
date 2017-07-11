pragma solidity ^0.4.11;

import "../controller/Controller.sol";
import "../VotingMachines/BoolVoteInterface.sol";
import "./UniversalScheme.sol";
import "../controller/Avatar.sol";

/**
 * @title A scheme to manage global constaintg for organizations
 * @dev The scheme is used to register or remove new global constraints
 */
contract GlobalConstraintRegistrar is UniversalScheme {

    // The struct that holds the information of a global constraint proposed to be added or removed.
    struct gcProposal {
        address gc; // The address of the global contraint contract.
        bytes32 parametersHash; // Parameters for global constraint.
        uint proposalType; // 1: add a GC, 2: remove a GC.
        bytes32 removeParams; // Voting parameters for removing this GC.
    }

    // Struct holding the data for each organization
    struct Organization {
        bool isRegistered;
        bytes32 voteRegisterParams; // The voting parameters for adding a GC.
        BoolVoteInterface boolVote; // The voting machine in which the voting takes place.
        mapping(bytes32=>gcProposal) proposals; // A mapping from the proposal ID to the proposal itself.
        mapping(address=>bytes32) removeParams; // A mapping that saves the parameters for removing each GC.
    }

    // A mapping from thr organization (Avatar) address to the saved data of the organization:
    mapping(address=>Organization) organizations;

    // A mapping from hashes to parameters (use to store a particular configuration on the controller)
    struct Parameters {
        bytes32 voteRegisterParams;
        BoolVoteInterface boolVote;
    }
    mapping(bytes32=>Parameters) parameters;


    function GlobalConstraintRegistrar(StandardToken _nativeToken, uint _fee, address _beneficiary) {
        updateParameters(_nativeToken, _fee, _beneficiary, bytes32(0));
    }

    /**
     * @dev hash the parameters, save them if necessary, and return the hash value
     */
    function setParameters(
        bytes32 _voteRegisterParams,
        BoolVoteInterface _boolVote
    ) returns(bytes32) {
        bytes32 paramsHash = getParametersHash(_voteRegisterParams, _boolVote);
        if (parameters[paramsHash].boolVote != address(0))  {
            parameters[paramsHash].voteRegisterParams = _voteRegisterParams;
            parameters[paramsHash].boolVote = _boolVote;
        }
        return paramsHash;
    }

    function getParametersHash(
        bytes32 _voteRegisterParams,
        BoolVoteInterface _boolVote
    ) constant returns(bytes32) {
        bytes32 paramsHash = (sha3(_voteRegisterParams, _boolVote));
        return paramsHash;
    }

    function getParametersFromController(Avatar _avatar) private constant returns(Parameters) {
       Controller controller = Controller(_avatar.owner());
       return parameters[controller.getSchemeParameters(this)];
    }

    // Adding an organization to the universal scheme:
    function addOrUpdateOrg(Avatar _avatar) {
      // Pay fees for using scheme:
      nativeToken.transferFrom(_avatar, beneficiary, fee);
      Organization memory org;
      org.isRegistered = true;
      organizations[_avatar] = org;
    }

    // Proposing to add a new GC:
    function proposeGC(Avatar _avatar, address _gc, bytes32 _parametersHash, bytes32 _removeParams) returns(bytes32) {
        Organization org = organizations[_avatar];
        Parameters memory params = getParametersFromController(_avatar);

        require(org.isRegistered); // Check org is registred to use this universal scheme.

        BoolVoteInterface boolVote = params.boolVote;
        bytes32 id = boolVote.propose(params.voteRegisterParams);
        if (org.proposals[id].proposalType != 0) {
          revert();
        }
        org.proposals[id].proposalType = 1;
        org.proposals[id].gc = _gc;
        org.proposals[id].parametersHash = _parametersHash;
        org.proposals[id].removeParams = _removeParams;
        voteGC(_avatar, id, true);
        return id;
    }

    // Proposing to remove a new GC:
    function proposeToRemoveGC(Avatar _avatar, address _gc) returns(bytes32) {
        Organization org = organizations[_avatar];
        Parameters memory params = getParametersFromController(_avatar);
        require(org.isRegistered); // Check org is registred to use this universal scheme.
        BoolVoteInterface boolVote = params.boolVote;
        bytes32 id = boolVote.propose(org.removeParams[_gc]);
        if (org.proposals[id].proposalType != 0) revert();
        org.proposals[id].proposalType = 2;
        org.proposals[id].gc = _gc;
        voteGC(_avatar, id, true);
        return id;
    }

    // Voting a GC, also handle the execuation when vote is over:
    function voteGC( Avatar _avatar, bytes32 id, bool _yes ) returns(bool) {
        Parameters memory params = getParametersFromController(_avatar);
        BoolVoteInterface boolVote = params.boolVote;
        if ( ! boolVote.vote(id, _yes, msg.sender) ) return false;
        if ( boolVote.voteResults(id) ) {
            Controller controller = Controller(_avatar.owner());
            gcProposal memory proposal = organizations[_avatar].proposals[id];
            if( ! boolVote.cancelProposal(id) ) revert();
            if( organizations[_avatar].proposals[id].proposalType == 2 ) {
                if( ! controller.removeGlobalConstraint(proposal.gc) ) revert();
            }
            if( organizations[_avatar].proposals[id].proposalType == 1 ) {
                if( ! controller.addGlobalConstraint(proposal.gc, proposal.parametersHash) ) revert();
            }
            organizations[_avatar].proposals[id].proposalType = 0;
        }
    }

    // Check the status of a vote:
    function getVoteStatus(Avatar _avatar, bytes32 id) constant returns(uint[3]) {
        Parameters memory params = getParametersFromController(_avatar);
        BoolVoteInterface boolVote = params.boolVote;
        return (boolVote.voteStatus(id));
    }
}
