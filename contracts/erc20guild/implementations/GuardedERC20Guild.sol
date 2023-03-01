// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.17;

import "../ERC20GuildUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/*
  @title GuardedERC20Guild
  @author github:AugustoL
  @dev An ERC20GuildUpgradeable with a guardian, the proposal time can be extended an extra 
  time for the guardian to end the proposal like it would happen normally from a base ERC20Guild or reject it directly.
*/
contract GuardedERC20Guild is ERC20GuildUpgradeable, OwnableUpgradeable {
    address public guildGuardian;
    uint256 public extraTimeForGuardian;

    /// @dev Initilizer
    /// @param _token The ERC20 token that will be used as source of voting power
    /// @param _proposalTime The amount of time in seconds that a proposal will be active for voting
    /// @param _timeForExecution The amount of time in seconds that a proposal action will have to execute successfully
    // solhint-disable-next-line max-line-length
    /// @param _votingPowerPercentageForProposalExecution The percentage of voting power in base 10000 needed to execute a proposal action
    // solhint-disable-next-line max-line-length
    /// @param _votingPowerPercentageForProposalCreation The percentage of voting power in base 10000 needed to create a proposal
    /// @param _name The name of the ERC20Guild
    /// @param _voteGas The amount of gas in wei unit used for vote refunds
    /// @param _maxGasPrice The maximum gas price used for vote refunds
    /// @param _maxActiveProposals The maximum amount of proposals to be active at the same time
    /// @param _lockTime The minimum amount of seconds that the tokens would be locked
    /// @param _permissionRegistry The address of the permission registry contract to be used
    function initialize(
        address _token,
        uint256 _proposalTime,
        uint256 _timeForExecution,
        uint256 _votingPowerPercentageForProposalExecution,
        uint256 _votingPowerPercentageForProposalCreation,
        string memory _name,
        uint256 _voteGas,
        uint256 _maxGasPrice,
        uint256 _maxActiveProposals,
        uint256 _lockTime,
        address _permissionRegistry
    ) public virtual override initializer {
        __Ownable_init();
        super.initialize(
            _token,
            _proposalTime,
            _timeForExecution,
            _votingPowerPercentageForProposalExecution,
            _votingPowerPercentageForProposalCreation,
            _name,
            _voteGas,
            _maxGasPrice,
            _maxActiveProposals,
            _lockTime,
            _permissionRegistry
        );
    }

    /// @dev Executes a proposal that is not votable anymore and can be finished
    // If this function is called by the guild guardian the proposal can end after proposal endTime
    // If this function is not called by the guild guardian the proposal can end after proposal endTime plus
    // the extraTimeForGuardian
    /// @param proposalId The id of the proposal to be ended
    function endProposal(bytes32 proposalId) public virtual override {
        if (msg.sender == guildGuardian)
            require(
                (proposals[proposalId].endTime < block.timestamp),
                "GuardedERC20Guild: Proposal hasn't ended yet for guardian"
            );
        else
            require(
                proposals[proposalId].endTime + extraTimeForGuardian < block.timestamp,
                "GuardedERC20Guild: Proposal hasn't ended yet for guild"
            );
        super.endProposal(proposalId);
    }

    /// @dev Reverts if proposal cannot be executed
    /// @param proposalId The id of the proposal to evaluate
    /// @param highestVoteAmount The amounts of votes received by the currently winning proposal option.
    function checkProposalExecutionState(bytes32 proposalId, uint256 highestVoteAmount) internal view override {
        require(!isExecutingProposal, "ERC20Guild: Proposal under execution");
        require(proposals[proposalId].state == ProposalState.Active, "ERC20Guild: Proposal already executed");

        uint256 approvalRate = (highestVoteAmount * BASIS_POINT_MULTIPLIER) / token.totalSupply();
        if (
            votingPowerPercentageForInstantProposalExecution == 0 ||
            approvalRate < votingPowerPercentageForInstantProposalExecution
        ) {
            uint256 endTime = msg.sender == guildGuardian
                ? proposals[proposalId].endTime
                : proposals[proposalId].endTime + extraTimeForGuardian;
            require(endTime < block.timestamp, "ERC20Guild: Proposal hasn't ended yet");
        } else {
            // Check if extra time has passed after vote
        }
    }

    /// @dev Internal function to set the amount of votingPower to vote in a proposal
    /// @param voter The address of the voter
    /// @param proposalId The id of the proposal to set the vote
    /// @param option The proposal option to be voted
    /// @param votingPower The amount of votingPower to use as voting for the proposal
    function _setVote(
        address voter,
        bytes32 proposalId,
        uint256 option,
        uint256 votingPower
    ) internal override {
        super._setVote(voter, proposalId, option, votingPower);

        if (votingPowerPercentageForInstantProposalExecution != 0) {
            // Check if the threshold for instant execution has been reached.
            uint256 votingPowerForInstantProposalExecution = (votingPowerPercentageForInstantProposalExecution *
                token.totalSupply()) / BASIS_POINT_MULTIPLIER;
            uint256 minVotingPower = MathUpgradeable.min(
                votingPowerForInstantProposalExecution,
                getVotingPowerForProposalExecution()
            );
            for (uint256 i = 1; i < proposals[proposalId].totalVotes.length; i++) {
                if (proposals[proposalId].totalVotes[i] >= minVotingPower) {
                    proposals[proposalId].endTime = block.timestamp;
                    break;
                }
            }
        }
    }

    /// @dev Rejects a proposal directly without execution, only callable by the guardian
    /// @param proposalId The id of the proposal to be rejected
    function rejectProposal(bytes32 proposalId) external {
        require(proposals[proposalId].state == ProposalState.Active, "GuardedERC20Guild: Proposal already executed");
        require((msg.sender == guildGuardian), "GuardedERC20Guild: Proposal can be rejected only by guardian");
        proposals[proposalId].state = ProposalState.Rejected;
        emit ProposalStateChanged(proposalId, uint256(ProposalState.Rejected));
    }

    /// @dev Set GuardedERC20Guild guardian configuration
    /// @param _guildGuardian The address of the guild guardian
    /// @param _extraTimeForGuardian The extra time the proposals would be locked for guardian verification
    function setGuardianConfig(address _guildGuardian, uint256 _extraTimeForGuardian) external {
        require(
            (guildGuardian == address(0)) || (msg.sender == address(this)),
            "GuardedERC20Guild: Only callable by the guild itself when guildGuardian is set"
        );
        require(_guildGuardian != address(0), "GuardedERC20Guild: guildGuardian cant be address 0");
        guildGuardian = _guildGuardian;
        extraTimeForGuardian = _extraTimeForGuardian;
    }

    /// @dev Get the guildGuardian address
    function getGuildGuardian() external view returns (address) {
        return guildGuardian;
    }

    /// @dev Get the extraTimeForGuardian
    function getExtraTimeForGuardian() external view returns (uint256) {
        return extraTimeForGuardian;
    }
}
