// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Local test doubles only. Never deploy these assets or this router to mainnet.
contract FixtureToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; emit Transfer(address(0), to, amount); }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transfer(address to, uint256 amount) external returns (bool) { require(balanceOf[msg.sender] >= amount); balanceOf[msg.sender] -= amount; balanceOf[to] += amount; emit Transfer(msg.sender, to, amount); return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount && balanceOf[from] >= amount);
        allowance[from][msg.sender] -= amount; balanceOf[from] -= amount; balanceOf[to] += amount;
        emit Transfer(from, to, amount); return true;
    }
}
interface IFixturePoolManager {
    struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }
    struct ModifyLiquidityParams { int24 tickLower; int24 tickUpper; int256 liquidityDelta; bytes32 salt; }
    function unlock(bytes calldata data) external returns (bytes memory);
    function modifyLiquidity(PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata hookData) external returns (int256, int256);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}
contract FixtureLiquidityProvider {
    IFixturePoolManager immutable manager;
    constructor(address value) { manager = IFixturePoolManager(value); }
    function add(IFixturePoolManager.PoolKey calldata key, int24 lower, int24 upper) external {
        manager.unlock(abi.encode(key, IFixturePoolManager.ModifyLiquidityParams(lower,upper,1e12,bytes32(0))));
    }
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (IFixturePoolManager.PoolKey memory key, IFixturePoolManager.ModifyLiquidityParams memory params) = abi.decode(data,(IFixturePoolManager.PoolKey, IFixturePoolManager.ModifyLiquidityParams));
        (int256 delta,) = manager.modifyLiquidity(key,params,hex"");
        settle(key.currency0,int128(delta >> 128)); settle(key.currency1,int128(delta));
        return hex"";
    }
    function settle(address currency, int128 delta) private {
        if (delta < 0) { manager.sync(currency); FixtureToken(currency).transfer(address(manager),uint128(-delta)); manager.settle(); }
        else if (delta > 0) manager.take(currency,address(this),uint128(delta));
    }
}
contract FixtureRouter {
    struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }
    struct Swap { PoolKey poolKey; bool zeroForOne; uint128 amountIn; uint128 amountOutMinimum; uint256 minHopPriceX36; bytes hookData; }
    bool public fail;
    address public lastCaller;
    uint256 public calls;
    function setFail(bool value) external { fail = value; }
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable {
        require(!fail && block.timestamp <= deadline && keccak256(commands) == keccak256(hex"10") && inputs.length == 1);
        (bytes memory actions, bytes[] memory params) = abi.decode(inputs[0], (bytes, bytes[]));
        require(keccak256(actions) == keccak256(hex"060c0f") && params.length == 3);
        Swap memory swap = abi.decode(params[0], (Swap));
        (address input, uint256 maximum) = abi.decode(params[1], (address, uint256));
        (address output, uint256 minimum) = abi.decode(params[2], (address, uint256));
        require(swap.amountIn <= maximum && swap.amountOutMinimum >= minimum);
        FixtureToken(input).transferFrom(msg.sender, address(this), swap.amountIn);
        FixtureToken(output).mint(msg.sender, swap.amountOutMinimum);
        lastCaller = msg.sender; ++calls;
    }
}
