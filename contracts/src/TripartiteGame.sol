// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TripartiteGame — provably-fair multilateral resource allocation.
///
/// This contract is the public referee for cooperative games (e.g. weapons-
/// inspection treaties) where N parties must operate under hard, observable
/// caps on three classes of scarce resource:
///
///   * COMPUTE   — backed by ComputeToken  (PoW-anchored Medulla scarcity)
///   * STORAGE   — backed by MemoryToken   (Hippocampus pin-lease scarcity)
///   * BANDWIDTH — backed by RoutingToken  (Cortex tx-routing scarcity)
///
/// Each party is registered with a per-epoch budget for each resource class.
/// All spends route through `consume()`, which:
///
///   1. enforces the per-epoch cap (no party can outspend its allowance),
///   2. atomically burns the underlying BandwidthToken (real on-chain scarcity),
///   3. emits a labelled public event (`Consumed`) any inspector can audit.
///
/// `verifyAllocationFair(epoch)` is the audit primitive: it returns true iff
/// no registered party exceeded its per-epoch budget for any resource at the
/// given epoch. This is the property that makes the game *provably* fair —
/// not by trusted-party assertion, but by re-derivation from on-chain state.
///
/// See docs/tripartite_game.md for the full game-theoretic argument.

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IBandwidthSpend {
    function spend(uint256 tokenId, uint256 amount, bytes32 reason) external;
    function balanceOfStack(uint256 tokenId) external view returns (uint256);
}

interface IStackOwner {
    function ownerOf(uint256 tokenId) external view returns (address);
}

contract TripartiteGame is Ownable {
    /// 0 = compute, 1 = storage (memory), 2 = bandwidth (routing).
    /// Three is the structural minimum for a multilateral observation treaty
    /// — fewer collapses to bilateral, more is a generalisation.
    uint8 public constant RESOURCE_COUNT = 3;
    uint8 public constant RES_COMPUTE   = 0;
    uint8 public constant RES_STORAGE   = 1;
    uint8 public constant RES_BANDWIDTH = 2;

    address public computeToken;
    address public memoryToken;
    address public routingToken;
    address public stackIdentity;

    struct Party {
        uint256 tokenId;          // StackIdentity NFT bound to this party
        bytes32 label;            // Human-readable handle (e.g. "inspector-A")
        uint256[3] perEpochBudget; // [compute, storage, bandwidth] caps per epoch
        bool registered;
    }

    /// gameId → tokenId → Party
    mapping(bytes32 => mapping(uint256 => Party)) internal _parties;
    /// gameId → list of tokenIds (for enumeration / audit)
    mapping(bytes32 => uint256[]) internal _roster;
    /// gameId → epoch → tokenId → resourceKind → consumed amount
    mapping(bytes32 => mapping(uint256 => mapping(uint256 => mapping(uint8 => uint256)))) public consumed;
    /// gameId → registered?
    mapping(bytes32 => bool) public games;

    event GameOpened(bytes32 indexed gameId, address indexed referee);
    event PartyRegistered(
        bytes32 indexed gameId,
        uint256 indexed tokenId,
        bytes32 label,
        uint256 computeBudget,
        uint256 storageBudget,
        uint256 bandwidthBudget
    );
    event Consumed(
        bytes32 indexed gameId,
        uint256 indexed tokenId,
        uint256 indexed epoch,
        uint8 resource,
        uint256 amount,
        bytes32 reason
    );
    event AllocationVerified(bytes32 indexed gameId, uint256 indexed epoch, bool fair);

    constructor(
        address _computeToken,
        address _memoryToken,
        address _routingToken,
        address _stackIdentity
    ) Ownable(msg.sender) {
        require(_computeToken != address(0), "compute=0");
        require(_memoryToken  != address(0), "memory=0");
        require(_routingToken != address(0), "routing=0");
        require(_stackIdentity != address(0), "stack=0");
        computeToken = _computeToken;
        memoryToken  = _memoryToken;
        routingToken = _routingToken;
        stackIdentity = _stackIdentity;
    }

    // ─── Game lifecycle ──────────────────────────────────────────────────

    /// @notice Open a new tripartite game. Only the contract owner (the
    ///         appointed referee) can open games.
    function openGame(bytes32 gameId) external onlyOwner {
        require(!games[gameId], "game exists");
        games[gameId] = true;
        emit GameOpened(gameId, msg.sender);
    }

    /// @notice Register a party with per-epoch budgets for each resource.
    ///         Only the StackIdentity owner may register their own stack.
    function registerParty(
        bytes32 gameId,
        uint256 tokenId,
        bytes32 label,
        uint256 computeBudget,
        uint256 storageBudget,
        uint256 bandwidthBudget
    ) external {
        require(games[gameId], "no game");
        require(IStackOwner(stackIdentity).ownerOf(tokenId) == msg.sender, "not stack owner");
        Party storage p = _parties[gameId][tokenId];
        require(!p.registered, "already registered");
        p.tokenId = tokenId;
        p.label = label;
        p.perEpochBudget[RES_COMPUTE]   = computeBudget;
        p.perEpochBudget[RES_STORAGE]   = storageBudget;
        p.perEpochBudget[RES_BANDWIDTH] = bandwidthBudget;
        p.registered = true;
        _roster[gameId].push(tokenId);
        emit PartyRegistered(gameId, tokenId, label, computeBudget, storageBudget, bandwidthBudget);
    }

    // ─── Spending (the only legal path) ──────────────────────────────────

    /// @notice Consume `amount` units of `resource` for `tokenId` at `epoch`.
    ///         Reverts if it would exceed the party's per-epoch budget.
    ///         Then atomically burns the equivalent BandwidthToken supply.
    ///
    ///         Caller must be the stack owner OR an authorised sleeve on the
    ///         underlying BandwidthToken (the underlying contract enforces).
    function consume(
        bytes32 gameId,
        uint256 tokenId,
        uint256 epoch,
        uint8 resource,
        uint256 amount,
        bytes32 reason
    ) external {
        require(games[gameId], "no game");
        require(resource < RESOURCE_COUNT, "bad resource");
        Party storage p = _parties[gameId][tokenId];
        require(p.registered, "not registered");

        uint256 already = consumed[gameId][epoch][tokenId][resource];
        uint256 cap = p.perEpochBudget[resource];
        require(already + amount <= cap, "exceeds per-epoch budget");

        consumed[gameId][epoch][tokenId][resource] = already + amount;

        // Burn the underlying bandwidth — this is the real scarcity sink.
        // The BandwidthToken contract enforces sleeve/owner authorisation.
        address tok = _tokenOf(resource);
        IBandwidthSpend(tok).spend(tokenId, amount, reason);

        emit Consumed(gameId, tokenId, epoch, resource, amount, reason);
    }

    // ─── Audit primitives ────────────────────────────────────────────────

    /// @notice True iff every registered party's consumption at `epoch` is
    ///         within its per-epoch budget for every resource. Any inspector
    ///         can call this — it reads only public state.
    function verifyAllocationFair(bytes32 gameId, uint256 epoch) external view returns (bool) {
        require(games[gameId], "no game");
        uint256[] storage roster = _roster[gameId];
        for (uint256 i = 0; i < roster.length; ++i) {
            uint256 tokenId = roster[i];
            Party storage p = _parties[gameId][tokenId];
            for (uint8 r = 0; r < RESOURCE_COUNT; ++r) {
                if (consumed[gameId][epoch][tokenId][r] > p.perEpochBudget[r]) {
                    return false;
                }
            }
        }
        return true;
    }

    /// @notice Emit (and return) the audit decision for `epoch` so it is
    ///         logged on-chain for treaty record-keeping.
    function auditEpoch(bytes32 gameId, uint256 epoch) external returns (bool) {
        bool fair = this.verifyAllocationFair(gameId, epoch);
        emit AllocationVerified(gameId, epoch, fair);
        return fair;
    }

    /// @notice Read remaining budget for a party at a specific epoch.
    function remainingBudget(
        bytes32 gameId,
        uint256 tokenId,
        uint256 epoch,
        uint8 resource
    ) external view returns (uint256) {
        Party storage p = _parties[gameId][tokenId];
        if (!p.registered || resource >= RESOURCE_COUNT) return 0;
        uint256 already = consumed[gameId][epoch][tokenId][resource];
        uint256 cap = p.perEpochBudget[resource];
        return cap > already ? cap - already : 0;
    }

    /// @notice Enumerate registered parties for an inspector.
    function rosterOf(bytes32 gameId) external view returns (uint256[] memory) {
        return _roster[gameId];
    }

    /// @notice Read a party's registered budget tuple.
    function budgetOf(bytes32 gameId, uint256 tokenId)
        external view
        returns (uint256 compute_, uint256 storage_, uint256 bandwidth_)
    {
        Party storage p = _parties[gameId][tokenId];
        return (
            p.perEpochBudget[RES_COMPUTE],
            p.perEpochBudget[RES_STORAGE],
            p.perEpochBudget[RES_BANDWIDTH]
        );
    }

    function _tokenOf(uint8 resource) internal view returns (address) {
        if (resource == RES_COMPUTE)   return computeToken;
        if (resource == RES_STORAGE)   return memoryToken;
        if (resource == RES_BANDWIDTH) return routingToken;
        revert("bad resource");
    }
}
