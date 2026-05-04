// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * NeedlecastRouter — coordinates state-transfer events across sleeves and
 * commits epoch anchors produced by the mining network.
 *
 * Off-chain components produce:
 *   - merkleRoot over encrypted shard CIDs (in the DAG)
 *   - epoch from the coordination engine
 *   - identity signature from the source stack
 *
 * This contract emits the event log that other chains (BTC-like settlement,
 * IPFS pinning services) subscribe to as the canonical "corpus callosum".
 */
interface IStackIdentity {
    function ownerOf(uint256 tokenId) external view returns (address);
    function recordNeedlecast(
        uint256 tokenId,
        bytes32 merkleRoot,
        uint256 epoch,
        address fromSleeveOwner,
        address toSleeveOwner
    ) external;
}

contract NeedlecastRouter {
    IStackIdentity public immutable identity;

    struct EpochAnchor {
        bytes32 crossRoot;     // root from coordination engine (cross-chain)
        uint256 epoch;
        uint256 timestamp;
        address miner;
    }

    EpochAnchor[] public anchors;

    event EpochAnchored(uint256 indexed epoch, bytes32 crossRoot, address indexed miner);
    event NeedlecastRouted(
        uint256 indexed tokenId,
        bytes32 merkleRoot,
        uint256 epoch,
        bytes32 fromSleeveId,
        bytes32 toSleeveId
    );
    event DesyncDetected(uint256 indexed tokenId, bytes32 sleeveId, uint256 drift);

    constructor(address identityContract) {
        identity = IStackIdentity(identityContract);
    }

    function anchorEpoch(bytes32 crossRoot, uint256 epoch) external {
        anchors.push(EpochAnchor({
            crossRoot: crossRoot,
            epoch: epoch,
            timestamp: block.timestamp,
            miner: msg.sender
        }));
        emit EpochAnchored(epoch, crossRoot, msg.sender);
    }

    function route(
        uint256 tokenId,
        bytes32 merkleRoot,
        uint256 epoch,
        bytes32 fromSleeveId,
        bytes32 toSleeveId
    ) external {
        require(identity.ownerOf(tokenId) == msg.sender, "not stack owner");
        identity.recordNeedlecast(tokenId, merkleRoot, epoch, msg.sender, msg.sender);
        emit NeedlecastRouted(tokenId, merkleRoot, epoch, fromSleeveId, toSleeveId);
    }

    function reportDesync(uint256 tokenId, bytes32 sleeveId, uint256 drift) external {
        emit DesyncDetected(tokenId, sleeveId, drift);
    }

    function anchorCount() external view returns (uint256) {
        return anchors.length;
    }
}
