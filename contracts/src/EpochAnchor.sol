// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EpochAnchor — receives anchor commits from medulla-pow via the bridge.
///        Stores the rolling Synaptic-Field MMR root and per-epoch coherence
///        roots for fast cross-chain consistency checks.

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract EpochAnchor is Ownable {
    struct Anchor {
        bytes32 crossRoot;
        bytes32 evmRoot;
        bytes32 ipfsRoot;
        bytes32 sleevesRoot;
        bytes32 synapticFieldRoot;  // MMR root from medulla-pow
        uint256 medullaHeight;
        uint256 ts;
    }
    mapping(uint256 => Anchor) public byEpoch;
    uint256 public head;
    /// medullaHeight of the most recent commit — must be strictly increasing
    /// across epochs to detect a forked or rewound Medulla chain.
    uint256 public lastMedullaHeight;

    mapping(address => bool) public bridgers;

    event EpochAnchored(uint256 indexed epoch, bytes32 crossRoot, bytes32 synapticFieldRoot, uint256 medullaHeight);
    event BridgerSet(address indexed b, bool ok);

    constructor() Ownable(msg.sender) {}

    function setBridger(address b, bool ok) external onlyOwner { bridgers[b] = ok; emit BridgerSet(b, ok); }

    function commitAnchor(
        uint256 epoch,
        bytes32 crossRoot, bytes32 evmRoot, bytes32 ipfsRoot, bytes32 sleevesRoot,
        bytes32 synapticFieldRoot, uint256 medullaHeight
    ) external {
        require(bridgers[msg.sender], "not bridger");
        require(epoch > head || head == 0, "epoch regression");
        // Medulla height must strictly increase — guards against a bridger
        // committing an anchor sourced from a stale or forked PoW tip.
        require(medullaHeight > lastMedullaHeight, "medulla height regression");
        byEpoch[epoch] = Anchor({
            crossRoot: crossRoot, evmRoot: evmRoot, ipfsRoot: ipfsRoot,
            sleevesRoot: sleevesRoot, synapticFieldRoot: synapticFieldRoot,
            medullaHeight: medullaHeight, ts: block.timestamp
        });
        head = epoch;
        lastMedullaHeight = medullaHeight;
        emit EpochAnchored(epoch, crossRoot, synapticFieldRoot, medullaHeight);
    }

    /// @notice Verify that the `synapticFieldRoot` recorded for `epoch` is a
    ///         witness-consistent extension of the previous anchor.
    ///
    ///         The Synaptic-Field MMR is rolling: each Medulla block appends
    ///         its own coherence-tuple hash and bags-the-peaks. The sequence
    ///         of `synapticFieldRoot` values across consecutive epochs is the
    ///         strongest cross-shard finality signal we publish to inspectors.
    ///
    ///         Returns:
    ///           - exists: true if both anchors are present.
    ///           - extended: true if the roots differ (i.e. new content was
    ///                       appended). Equality across epochs implies a stalled
    ///                       Medulla and is observably suspect.
    function verifyContinuity(uint256 epoch)
        external view
        returns (bool exists, bool extended)
    {
        if (epoch == 0) return (false, false);
        Anchor storage cur  = byEpoch[epoch];
        Anchor storage prev = byEpoch[epoch - 1];
        if (cur.ts == 0 || prev.ts == 0) return (false, false);
        return (true, cur.synapticFieldRoot != prev.synapticFieldRoot
                   && cur.medullaHeight > prev.medullaHeight);
    }

    /// @notice Verify an inclusion proof of a leaf hash against an epoch's
    ///         shard-specific Merkle root. Used by inspectors to prove that a
    ///         specific event (e.g. a particular Cortex tx, a Hippocampus
    ///         write, or a sleeve event) was included in the anchored set.
    ///
    /// @param epoch        Epoch to verify against.
    /// @param shard        0=evm, 1=ipfs, 2=sleeves.
    /// @param leaf         Leaf hash being proven.
    /// @param siblings     Merkle proof siblings, leaf→root order.
    /// @param indexBits    Bit-encoded path: bit i = 1 means leaf is right sibling at level i.
    function verifyShardInclusion(
        uint256 epoch,
        uint8 shard,
        bytes32 leaf,
        bytes32[] calldata siblings,
        uint256 indexBits
    ) external view returns (bool) {
        Anchor storage a = byEpoch[epoch];
        if (a.ts == 0) return false;
        bytes32 want;
        if (shard == 0) want = a.evmRoot;
        else if (shard == 1) want = a.ipfsRoot;
        else if (shard == 2) want = a.sleevesRoot;
        else return false;
        bytes32 cur = leaf;
        for (uint256 i = 0; i < siblings.length; ++i) {
            bool right = ((indexBits >> i) & 1) == 1;
            if (right) {
                cur = keccak256(abi.encodePacked(siblings[i], cur));
            } else {
                cur = keccak256(abi.encodePacked(cur, siblings[i]));
            }
        }
        return cur == want;
    }
}
