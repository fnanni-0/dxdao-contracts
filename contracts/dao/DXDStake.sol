// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20SnapshotUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./DXDInfluence.sol";

/**
 * @title DXDStake
 * @dev DXD wrapper contract. DXD tokens converted into DXDStake tokens get locked and are not transferable.
 * Users staking DXD in this contract decide for how much time their tokens will be locked. This stake commitment
 * cannot be undone unless early withdrawals are enabled by governance, in which case a penalty might apply.
 * How long users commit to stake is important, given that the more time tokens are staked, the more voting power
 * that user gets. The DXDStake influence on governance as a function of time is handled by the DXDInfluence contract.
 * How long tokens can be staked, is capped by `maxTimeCommitment`. This prevents users from abusing the governance
 * influence formula by staking small amounts of tokens for an infinite time.
 */
contract DXDStake is OwnableUpgradeable, ERC20SnapshotUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct StakeCommitment {
        uint256 commitmentEnd;
        uint256 timeCommitment;
        uint256 stake;
    }

    uint256 private constant BASIS_POINT_DIVISOR = 10_000;

    IERC20Upgradeable public dxd;
    DXDInfluence public dxdInfluence;
    uint256 public maxTimeCommitment;

    mapping(address => StakeCommitment[]) public stakeCommitments; // stakeCommitments[account]
    mapping(address => uint256) public userActiveStakes;
    uint256 public totalActiveStakes;

    bool public earlyWithdrawalsEnabled;
    /// @dev a penalty might apply when withdrawing a stake early. The penalty will be sent to the  `penaltyRecipient`.
    address public penaltyRecipient;
    /// @dev basis points. If enabled, early withdrawals are allowed after a % of the commitment time has passed.
    uint256 public earlyWithdrawalMinTime;
    /// @dev basis points. A % of the tokens staked will be taken away for withdrawing early.
    uint256 public earlyWithdrawalPenalty;

    /// @notice Error when trying to transfer reputation
    error DXDStake__NoTransfer();

    constructor() {}

    function initialize(
        address _dxd,
        address _dxdInfluence,
        address _owner,
        uint256 _maxTimeCommitment,
        string memory name,
        string memory symbol
    ) external initializer {
        __ERC20_init(name, symbol);
        __Ownable_init();

        _transferOwnership(_owner);
        dxd = IERC20Upgradeable(_dxd);
        dxdInfluence = DXDInfluence(_dxdInfluence);

        maxTimeCommitment = _maxTimeCommitment;
    }

    /**
     * @dev Changes the maximum time a stake can be committed. If time commitments are not capped, the
     * influence formula would be vulnerable to small stakes with nonsensically huge time commitments.
     * @param _maxTimeCommitment new maximum value for time commitments in seconds.
     */
    function changeMaxTimeCommitment(uint256 _maxTimeCommitment) external onlyOwner {
        maxTimeCommitment = _maxTimeCommitment;
    }

    /**
     * @dev Disables early withdrawals of stake commitments that have not finalized yet.
     */
    function disableEarlyWithdrawal() external onlyOwner {
        earlyWithdrawalsEnabled = false;
    }

    /**
     * @dev Enables early withdrawals of stake commitments that have not finalized yet.
     * @param _minTime Percentage, expressed in basis points, after which a stake commitment can be withdrawn.
     * @param _penalty Percentage, expressed in basis points, that will be taken from the stake as penalty.
     * @param _recipient Recipient of the penalty.
     */
    function enableEarlyWithdrawal(
        uint256 _minTime,
        uint256 _penalty,
        address _recipient
    ) external onlyOwner {
        require(_penalty <= BASIS_POINT_DIVISOR, "DXDStake: invalid penalty");
        require(_minTime <= BASIS_POINT_DIVISOR, "DXDStake: invalid earlyWithdrawalMinTime");
        require(_recipient != address(0), "DXDStake: recipient can't be null");
        earlyWithdrawalsEnabled = true;
        earlyWithdrawalPenalty = _penalty;
        penaltyRecipient = _recipient;
        earlyWithdrawalMinTime = _minTime;
    }

    /**
     * @dev Changes the influence formula factors.
     * @param _linearFactor Factor that will multiply the linear element of the DXD influence. 18 decimals.
     * @param _exponentialFactor Factor that will multiply the exponential element of the DXD influence. 18 decimals.
     */
    function changeInfluenceFormula(int256 _linearFactor, int256 _exponentialFactor) external onlyOwner {
        dxdInfluence.changeFormula(_linearFactor, _exponentialFactor);
    }

    /// @dev Do not allow the transfer of tokens.
    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal virtual override {
        revert DXDStake__NoTransfer();
    }

    /**
     * @dev Stakes tokens from the user.
     * @param _amount Amount of tokens to stake.
     * @param _timeCommitment Time that the user commits to lock the tokens in this staking contract.
     */
    function stake(uint256 _amount, uint256 _timeCommitment) external {
        require(_timeCommitment <= maxTimeCommitment, "DXDStake: timeCommitment too big");

        StakeCommitment storage stakeCommitment = stakeCommitments[msg.sender].push();
        stakeCommitment.stake = _amount;
        stakeCommitment.timeCommitment = _timeCommitment;
        stakeCommitment.commitmentEnd = block.timestamp + _timeCommitment;
        userActiveStakes[msg.sender] += 1;
        totalActiveStakes += 1;

        // Mint influence tokens.
        dxdInfluence.mint(msg.sender, _amount, _timeCommitment);

        // Stake DXD tokens
        dxd.safeTransferFrom(msg.sender, address(this), _amount);
        _mint(msg.sender, _amount);
        _snapshot();
    }

    /**
     * @dev Updates an existing commitment. The stake remains the same, but the time period is updated.
     * The influence is calculated according to the new time commited, not the original one.
     * @param _commitmentId Id of the commitment. The Id is an incremental variable for each account.
     * @param _newTimeCommitment Time that the user commits to lock the token in this staking contract.
     */
    function increaseCommitmentTime(uint256 _commitmentId, uint256 _newTimeCommitment) external {
        require(_newTimeCommitment <= maxTimeCommitment, "DXDStake: timeCommitment too big");
        StakeCommitment storage stakeCommitment = stakeCommitments[msg.sender][_commitmentId];
        require(
            stakeCommitment.commitmentEnd <= block.timestamp + _newTimeCommitment,
            "DXDStake: timeCommitment too small"
        );

        // Update influence. Burning and minting is inefficient, because an extra snapshot is taken.
        dxdInfluence.burn(msg.sender, stakeCommitment.stake, stakeCommitment.timeCommitment);
        dxdInfluence.mint(msg.sender, stakeCommitment.stake, _newTimeCommitment);

        stakeCommitment.timeCommitment = _newTimeCommitment;
        stakeCommitment.commitmentEnd = block.timestamp + _newTimeCommitment;
    }

    /**
     * @dev Withdraws the tokens to the user.
     * @param _account Account that has staked.
     * @param _commitmentId Id of the commitment. The Id is an incremental variable for each account.
     */
    function withdraw(address _account, uint256 _commitmentId) external {
        StakeCommitment storage stakeCommitment = stakeCommitments[_account][_commitmentId];
        require(stakeCommitment.commitmentEnd != 0, "DXDStake: commitment id does not exist");
        require(block.timestamp > stakeCommitment.commitmentEnd, "DXDStake: withdrawal not allowed");

        _withdraw(stakeCommitment, _account);
    }

    /**
     * @dev Withdraws the tokens to the user before the commitment is finalized,
     * if early withdrawals was previously enabled by governance. A penalty might apply if set.
     * @param _commitmentId Id of the commitment. The Id is an incremental variable for each account.
     */
    function earlyWithdraw(uint256 _commitmentId) external {
        StakeCommitment storage stakeCommitment = stakeCommitments[msg.sender][_commitmentId];
        require(earlyWithdrawalsEnabled, "DXDStake: early withdrawals not allowed");
        require(block.timestamp < stakeCommitment.commitmentEnd, "DXDStake: normal withdrawal allowed");

        uint256 maxTimeLeft = (stakeCommitment.timeCommitment * (BASIS_POINT_DIVISOR - earlyWithdrawalMinTime)) /
            BASIS_POINT_DIVISOR;
        require(
            block.timestamp > stakeCommitment.commitmentEnd - maxTimeLeft,
            "DXDStake: early withdrawal attempted too soon"
        );

        // Unstake DXD tokens
        uint256 dxdPenalty = (stakeCommitment.stake * earlyWithdrawalPenalty) / BASIS_POINT_DIVISOR;
        dxd.safeTransfer(penaltyRecipient, dxdPenalty);

        stakeCommitment.stake -= dxdPenalty;
        _withdraw(stakeCommitment, msg.sender);
    }

    function _withdraw(StakeCommitment storage _stakeCommitment, address _account) internal {
        // Burn influence tokens.
        dxdInfluence.burn(_account, _stakeCommitment.stake, _stakeCommitment.timeCommitment);

        // Unstake DXD tokens
        dxd.safeTransfer(_account, _stakeCommitment.stake);
        _burn(_account, _stakeCommitment.stake);
        _snapshot();

        _stakeCommitment.stake = 0;
        _stakeCommitment.timeCommitment = 0;
        _stakeCommitment.commitmentEnd = 0;
        userActiveStakes[_account] -= 1;
        totalActiveStakes -= 1;
    }

    /**
     * @dev Total stakes for the given address counting both active and withdrawn commitments.
     * @param _account Account that has staked.
     */
    function getAccountTotalStakes(address _account) external view returns (uint256) {
        return stakeCommitments[_account].length;
    }

    /**
     * @dev Get a stake commitment data.
     * @param _account Account that has staked.
     * @param _commitmentId Id of the commitment. The Id is an incremental variable for each account.
     */
    function getStakeCommitment(address _account, uint256 _commitmentId)
        external
        view
        returns (StakeCommitment memory)
    {
        return stakeCommitments[_account][_commitmentId];
    }

    /**
     * @dev Get the amount of stakes ever, counting both active and inactive ones.
     */
    function getTotalStakes() external view returns (uint256) {
        return (_getCurrentSnapshotId() + totalActiveStakes) / 2;
    }

    /**
     * @dev Get the current snapshotId
     */
    function getCurrentSnapshotId() external view returns (uint256) {
        return _getCurrentSnapshotId();
    }
}
