// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * BandwidthToken — minimal ERC-20-shaped token used to model one of the
 * four cognitive bandwidth resources:
 *   - ComputeToken : cognitive processing rate
 *   - MemoryToken  : recall depth
 *   - SyncToken    : embodiment coherence stability
 *   - RoutingToken : inter-node visibility
 *
 * All four are deployed from this same template with different metadata.
 * Burning bandwidth represents spending cognitive attention.
 */
contract BandwidthToken {
    string public name;
    string public symbol;
    uint8  public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public minter;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event BandwidthSpent(address indexed sleeve, uint256 amount, bytes32 reason);

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
        minter = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "not minter");
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _transfer(from, to, amount);
        return true;
    }

    /// Spend bandwidth for a labeled cognitive operation (decrement supply).
    function spend(uint256 amount, bytes32 reason) external {
        require(balanceOf[msg.sender] >= amount, "insufficient bandwidth");
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
        emit BandwidthSpent(msg.sender, amount, reason);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to]   += amount;
        emit Transfer(from, to, amount);
    }
}
