// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title RouteOracle
/// @notice On-chain registry of human-approved agent status for Axonal-BGP.
///         Provides auto-pause heuristics, emergency-pause (1-of-N guardian),
///         and resume (M-of-N guardian multisig).  Observable by any peer.

interface ISwap {
    function setPaused(bool p) external;
}

contract RouteOracle is Ownable {
    ISwap public swap;

    // ── Guardian multisig ───────────────────────────────────────────
    address[] public guardians;
    uint256   public threshold;   // M-of-N for resume actions

    mapping(bytes32 => mapping(address => bool)) public approvals;
    mapping(bytes32 => uint256)                  public approvalCount;
    mapping(bytes32 => bool)                     public executed;

    // ── Per-agent state ─────────────────────────────────────────────
    mapping(uint256 => bool)    public agentPaused;
    mapping(uint256 => uint256) public residueCount;       // rolling count in observation window
    mapping(uint256 => uint256) public lastResidueEpoch;   // last epoch a residue was recorded
    mapping(uint256 => uint256) public lastSwapEpoch;

    // ── Auto-pause heuristics ───────────────────────────────────────
    uint256 public autoPauseResidueRate  = 5;       // ≥5 residues in observation window
    uint256 public autoPauseSwapBurst    = 100 ether; // ≥100 RTE minted in one epoch
    uint256 public observationWindow     = 10;      // epochs

    // ── Events ──────────────────────────────────────────────────────
    event GuardiansChanged(address[] guardians, uint256 threshold);
    event AgentPaused(uint256 indexed agentTokenId, string reason);
    event AgentResumed(uint256 indexed agentTokenId, address[] approvers);
    event ApprovalCast(bytes32 indexed actionId, address indexed guardian);
    event ActionExecuted(bytes32 indexed actionId);
    event AutoPauseConfigChanged(uint256 residueRate, uint256 swapBurst, uint256 window);

    // ── Modifiers ───────────────────────────────────────────────────
    modifier onlyGuardian() {
        require(_isGuardian(msg.sender), "not guardian");
        _;
    }

    constructor(
        address _swap,
        address[] memory _guardians,
        uint256 _threshold
    ) Ownable(msg.sender) {
        require(_guardians.length >= _threshold && _threshold > 0, "bad threshold");
        swap       = ISwap(_swap);
        guardians  = _guardians;
        threshold  = _threshold;
        emit GuardiansChanged(_guardians, _threshold);
    }

    // ── Guardian management ─────────────────────────────────────────

    function setGuardians(address[] calldata _guardians, uint256 _threshold) external onlyOwner {
        require(_guardians.length >= _threshold && _threshold > 0, "bad threshold");
        guardians = _guardians;
        threshold = _threshold;
        emit GuardiansChanged(_guardians, _threshold);
    }

    function guardianCount() external view returns (uint256) {
        return guardians.length;
    }

    // ── Emergency pause (1-of-N) ────────────────────────────────────

    /// @notice Any single guardian can pause an agent immediately.
    function emergencyPause(uint256 agentTokenId, string calldata reason) external onlyGuardian {
        agentPaused[agentTokenId] = true;
        emit AgentPaused(agentTokenId, reason);
    }

    /// @notice Any single guardian can halt the swap as a belt-and-braces measure.
    function haltSwap() external onlyGuardian {
        swap.setPaused(true);
    }

    // ── Resume (M-of-N) ────────────────────────────────────────────

    /// @notice Cast an approval vote for a resume action.
    function approveResume(uint256 agentTokenId) external onlyGuardian {
        bytes32 actionId = keccak256(abi.encode("resume", agentTokenId));
        require(!approvals[actionId][msg.sender], "already approved");
        approvals[actionId][msg.sender] = true;
        approvalCount[actionId]++;
        emit ApprovalCast(actionId, msg.sender);
    }

    /// @notice Execute a resume action if enough approvals have been cast.
    function executeResume(uint256 agentTokenId) external {
        bytes32 actionId = keccak256(abi.encode("resume", agentTokenId));
        require(approvalCount[actionId] >= threshold, "below threshold");
        require(!executed[actionId], "already executed");
        executed[actionId] = true;
        agentPaused[agentTokenId] = false;
        emit AgentResumed(agentTokenId, guardians);
        emit ActionExecuted(actionId);
    }

    // ── Observation hot path ────────────────────────────────────────

    /// @notice Called by an off-chain relayer when a swap event is observed.
    function observeSwap(
        uint256 agentTokenId,
        uint256 routingOut,
        uint256 currentEpoch
    ) external onlyOwner {
        lastSwapEpoch[agentTokenId] = currentEpoch;
        if (routingOut >= autoPauseSwapBurst) {
            agentPaused[agentTokenId] = true;
            emit AgentPaused(agentTokenId, "swap-burst");
        }
    }

    /// @notice Called by an off-chain relayer when a routing residue is detected.
    function observeResidue(
        uint256 agentTokenId,
        uint256 currentEpoch
    ) external onlyOwner {
        // Reset counter if we've moved past the observation window
        if (currentEpoch > lastResidueEpoch[agentTokenId] + observationWindow) {
            residueCount[agentTokenId] = 0;
        }
        lastResidueEpoch[agentTokenId] = currentEpoch;
        residueCount[agentTokenId]++;

        if (residueCount[agentTokenId] >= autoPauseResidueRate) {
            agentPaused[agentTokenId] = true;
            emit AgentPaused(agentTokenId, "residue-rate");
        }
    }

    // ── Admin ───────────────────────────────────────────────────────

    function setSwap(address _swap) external onlyOwner {
        swap = ISwap(_swap);
    }

    function setAutoPauseConfig(
        uint256 _residueRate,
        uint256 _swapBurst,
        uint256 _window
    ) external onlyOwner {
        autoPauseResidueRate = _residueRate;
        autoPauseSwapBurst   = _swapBurst;
        observationWindow    = _window;
        emit AutoPauseConfigChanged(_residueRate, _swapBurst, _window);
    }

    // ── Internal ────────────────────────────────────────────────────

    function _isGuardian(address who) internal view returns (bool) {
        for (uint256 i = 0; i < guardians.length; i++) {
            if (guardians[i] == who) return true;
        }
        return false;
    }
}
