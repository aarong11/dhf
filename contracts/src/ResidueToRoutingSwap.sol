// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ResidueToRoutingSwap
/// @notice One-way conversion from ResidueToken → RoutingToken, priced by an
///         Epoch-Binding-Curve that decays the exchange rate over time.
///         Rate-limited per agent per epoch and globally per epoch.

interface IBandwidthToken {
    function balanceOfStack(uint256 tokenId) external view returns (uint256);
    function spend(uint256 tokenId, uint256 amount, bytes32 reason) external;
    function mint(uint256 tokenId, uint256 amount, bytes32 reason) external;
}

contract ResidueToRoutingSwap is Ownable {
    IBandwidthToken public immutable residueToken;
    IBandwidthToken public immutable routingToken;

    // EBC parameters (scaled ×1e6)
    uint256 public baseRateX1e6     = 500_000;   // 0.5 RTE per RES at epoch of resolution
    uint256 public decayRateX1e6    =  50_000;   // 5 % per epoch decay
    uint256 public floorRateX1e6    = 100_000;   // floor at 10 % of base

    // Rate limits
    uint256 public perEpochCapPerAgent = 50 ether;
    uint256 public globalPerEpochCap   = 5_000 ether;

    // Consumption tracking
    mapping(uint256 => mapping(uint256 => uint256)) public consumedAgent;   // agentTokenId → epoch → amount
    mapping(uint256 => uint256)                     public consumedGlobal;  // epoch → amount

    // Oracle integration
    address public routeOracle;
    bool    public paused;

    // ── Events ──────────────────────────────────────────────────────
    event Swapped(
        uint256 indexed agentTokenId,
        uint256 residueAmount,
        uint256 routingAmount,
        uint256 epochAtResolution,
        uint256 currentEpoch,
        bytes32 sourceResidueId
    );
    event RateChanged(uint256 baseRateX1e6, uint256 decayRateX1e6, uint256 floorRateX1e6);
    event CapsChanged(uint256 perAgent, uint256 global);
    event OracleChanged(address indexed oracle);
    event PausedChanged(bool paused);

    // ── Modifiers ───────────────────────────────────────────────────
    modifier whenNotPaused() {
        require(!paused, "swap paused");
        _;
    }

    constructor(address _residueToken, address _routingToken) Ownable(msg.sender) {
        residueToken = IBandwidthToken(_residueToken);
        routingToken = IBandwidthToken(_routingToken);
    }

    // ── Quote ───────────────────────────────────────────────────────

    /// @notice Preview the RoutingToken output for a given ResidueToken input.
    /// @param residueAmount  Amount of ResidueToken to convert (18-dec).
    /// @param epochAtResolution  The epoch when the source residue was resolved.
    /// @param currentEpoch  The current Medulla epoch number.
    /// @return routingOut  RoutingToken that would be minted.
    function quote(
        uint256 residueAmount,
        uint256 epochAtResolution,
        uint256 currentEpoch
    ) public view returns (uint256 routingOut) {
        require(currentEpoch >= epochAtResolution, "future resolution");
        uint256 elapsed = currentEpoch - epochAtResolution;
        uint256 multX1e6 = baseRateX1e6;
        // Apply exponential decay: multX1e6 *= (1 - decayRate)^elapsed
        for (uint256 i = 0; i < elapsed && i < 200; i++) {
            multX1e6 = (multX1e6 * (1_000_000 - decayRateX1e6)) / 1_000_000;
        }
        if (multX1e6 < floorRateX1e6) multX1e6 = floorRateX1e6;
        routingOut = (residueAmount * multX1e6) / 1_000_000;
    }

    // ── Swap ────────────────────────────────────────────────────────

    /// @notice Convert ResidueToken → RoutingToken.  Burns residue, mints routing.
    function swap(
        uint256 agentTokenId,
        uint256 residueAmount,
        uint256 epochAtResolution,
        bytes32 sourceResidueId,
        uint256 currentEpoch
    ) external whenNotPaused {
        require(residueAmount > 0, "zero amount");
        uint256 routingOut = quote(residueAmount, epochAtResolution, currentEpoch);
        require(routingOut > 0, "below floor");

        // Rate limits
        require(
            consumedAgent[agentTokenId][currentEpoch] + routingOut <= perEpochCapPerAgent,
            "agent epoch cap"
        );
        require(
            consumedGlobal[currentEpoch] + routingOut <= globalPerEpochCap,
            "global epoch cap"
        );

        // Burn residue, mint routing
        residueToken.spend(agentTokenId, residueAmount, "swap-out");
        routingToken.mint(agentTokenId, routingOut, "swap-in");

        // Track
        consumedAgent[agentTokenId][currentEpoch] += routingOut;
        consumedGlobal[currentEpoch]              += routingOut;

        emit Swapped(agentTokenId, residueAmount, routingOut, epochAtResolution, currentEpoch, sourceResidueId);
    }

    // ── Admin ───────────────────────────────────────────────────────

    function setRouteOracle(address o) external onlyOwner {
        routeOracle = o;
        emit OracleChanged(o);
    }

    function setPaused(bool p) external {
        require(msg.sender == owner() || msg.sender == routeOracle, "not authorised");
        paused = p;
        emit PausedChanged(p);
    }

    function setRate(uint256 _base, uint256 _decay, uint256 _floor) external onlyOwner {
        require(_base > 0 && _floor <= _base, "bad rate");
        baseRateX1e6  = _base;
        decayRateX1e6 = _decay;
        floorRateX1e6 = _floor;
        emit RateChanged(_base, _decay, _floor);
    }

    function setCaps(uint256 perAgent, uint256 global) external onlyOwner {
        perEpochCapPerAgent = perAgent;
        globalPerEpochCap   = global;
        emit CapsChanged(perAgent, global);
    }
}
