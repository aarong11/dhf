// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * StackIdentity — minimal ERC-721 anchor for a DHF Stack.
 *
 * Each tokenId represents a persistent cognitive identity. The on-chain
 * record is intentionally thin: it stores only an identity public key and a
 * pointer to the latest cross-chain coherence root. Memory, sleeves, and
 * cognitive state live off-chain (DAG + sleeves + coordination engine).
 *
 * Identity is NOT moved between sleeves; sleeves authenticate against the
 * pubkey stored here, and "needlecasts" commit a Merkle root of encrypted
 * shards that destination sleeves use to reconstruct local state.
 */
contract StackIdentity {
    struct Stack {
        address owner;
        bytes   identityPubKey;
        bytes32 latestCoherenceRoot;
        uint256 epoch;
    }

    uint256 public nextTokenId = 1;
    mapping(uint256 => Stack) public stacks;
    mapping(address => uint256) public balanceOf;

    event StackMinted(uint256 indexed tokenId, address indexed owner);
    event Needlecast(
        uint256 indexed tokenId,
        bytes32 merkleRoot,
        uint256 epoch,
        address indexed fromSleeveOwner,
        address indexed toSleeveOwner
    );
    event CoherenceUpdated(uint256 indexed tokenId, bytes32 root, uint256 epoch);

    function mintStack(bytes calldata identityPubKey) external returns (uint256 id) {
        id = nextTokenId++;
        stacks[id] = Stack({
            owner: msg.sender,
            identityPubKey: identityPubKey,
            latestCoherenceRoot: bytes32(0),
            epoch: 0
        });
        balanceOf[msg.sender] += 1;
        emit StackMinted(id, msg.sender);
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return stacks[tokenId].owner;
    }

    /**
     * Anchor a needlecast envelope on-chain. Off-chain shards live in the
     * IPFS-like DAG; we only commit the Merkle root + epoch.
     */
    function recordNeedlecast(
        uint256 tokenId,
        bytes32 merkleRoot,
        uint256 epoch,
        address fromSleeveOwner,
        address toSleeveOwner
    ) external {
        Stack storage s = stacks[tokenId];
        require(s.owner == msg.sender, "not owner");
        require(epoch >= s.epoch, "epoch regression");
        s.latestCoherenceRoot = merkleRoot;
        s.epoch = epoch;
        emit Needlecast(tokenId, merkleRoot, epoch, fromSleeveOwner, toSleeveOwner);
        emit CoherenceUpdated(tokenId, merkleRoot, epoch);
    }
}
