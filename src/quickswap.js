require('dotenv').config();
const ethers = require('ethers');

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.MAIN_PRIVATE_KEY, provider);

const QUICKSWAP_ADDRESS = "0xE94de02e52Eaf9F0f6Bf7f16E4927FcBc2c09bC7";
const FACTORY_ADDRESS = "0x0BFaCE9a5c9F884a4f09fadB83b69e81EA41424B";
const MIN_GAS_BALANCE = process.env.MIN_GAS_BALANCE || "0.01";

const TOKENS = {
    STT: { address: null, symbol: "STT", decimals: 18, isNative: true },
    WSTT: { address: "0x4A3BC48C156384f9564Fd65A53a2f3D534D8f2b7", symbol: "WSTT", decimals: 18, isNative: false },
    USDC: { address: "0xE9CC37904875B459Fa5D0FE37680d36F1ED55e38", symbol: "USDC", decimals: 6, isNative: false },
    WETH: { address: "0xd2480162Aa7F02Ead7BF4C127465446150D58452", symbol: "WETH", decimals: 18, isNative: false }
};

const erc20Abi = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function deposit() external payable",
    "function withdraw(uint256 amount) external",
    "function decimals() external view returns (uint8)"
];

const quickSwapAbi = [
    {
        "inputs": [
            {
                "components": [
                    { "internalType": "address", "name": "tokenIn", "type": "address" },
                    { "internalType": "address", "name": "tokenOut", "type": "address" },
                    { "internalType": "address", "name": "deployer", "type": "address" },
                    { "internalType": "address", "name": "recipient", "type": "address" },
                    { "internalType": "uint256", "name": "deadline", "type": "uint256" },
                    { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
                    { "internalType": "uint256", "name": "amountOutMinimum", "type": "uint256" },
                    { "internalType": "uint160", "name": "limitSqrtPrice", "type": "uint160" }
                ],
                "internalType": "struct ISwapRouter.ExactInputSingleParams",
                "name": "params",
                "type": "tuple"
            }
        ],
        "name": "exactInputSingle",
        "outputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }],
        "stateMutability": "payable",
        "type": "function"
    },
    { "inputs": [], "name": "WNativeToken", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "factory", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" }
];

const factoryAbi = [
    {
        "inputs": [
            { "internalType": "address", "name": "tokenA", "type": "address" },
            { "internalType": "address", "name": "tokenB", "type": "address" },
            { "internalType": "uint24", "name": "fee", "type": "uint24" }
        ],
        "name": "getPool",
        "outputs": [{ "internalType": "address", "name": "pool", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    }
];

const poolAbi = [
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function fee() external view returns (uint24)",
    "function liquidity() external view returns (uint128)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
];

const quickSwapContract = new ethers.Contract(QUICKSWAP_ADDRESS, quickSwapAbi, wallet);

const tokenContracts = {};
for (const tokenKey in TOKENS) {
    const token = TOKENS[tokenKey];
    if (!token.isNative) {
        tokenContracts[tokenKey] = new ethers.Contract(token.address, erc20Abi, wallet);
    }
}

async function logContractDetails() {
    try {
        const wNativeToken = await quickSwapContract.WNativeToken();
        console.log(`WNativeToken Address: ${wNativeToken}`);
        if (wNativeToken.toLowerCase() !== TOKENS.WSTT.address.toLowerCase()) {
            throw new Error(`WNativeToken (${wNativeToken}) does not match expected WSTT address (${TOKENS.WSTT.address})`);
        }
        const factory = await quickSwapContract.factory();
        console.log(`Factory Address: ${factory}`);
        return { factory };
    } catch (error) {
        console.error("Error fetching contract details:", error.message);
        throw error;
    }
}

async function getPoolPrice(poolAddress) {
    const poolContract = new ethers.Contract(poolAddress, poolAbi, provider);
    const slot0 = await poolContract.slot0();
    const sqrtPriceX96 = slot0.sqrtPriceX96;
    // Convert sqrtPriceX96 to price (WSTT/USDC)
    const price = (Number(sqrtPriceX96) ** 2) / (2 ** 192) * (10 ** 12); // Adjust for decimals (18 - 6)
    console.log(`Current pool price: 1 WSTT = ${price} USDC`);
    return price;
}

async function checkLiquidityPool(factoryAddress, tokenInAddress, tokenOutAddress, feeTier = 3000) {
    try {
        const factoryContract = new ethers.Contract(factoryAddress, factoryAbi, provider);
        const poolAddress = await factoryContract.getPool(tokenInAddress, tokenOutAddress, feeTier);
        console.log(`Liquidity Pool for ${tokenInAddress} - ${tokenOutAddress} (Fee ${feeTier}): ${poolAddress}`);
        if (poolAddress === ethers.ZeroAddress) {
            console.log(`No pool found for fee tier ${feeTier}.`);
            return null;
        }
        const poolContract = new ethers.Contract(poolAddress, poolAbi, provider);
        const liquidity = await poolContract.liquidity();
        const token0 = await poolContract.token0();
        const token1 = await poolContract.token1();
        const fee = await poolContract.fee();
        const usdcBalance = await tokenContracts["USDC"].balanceOf(poolAddress);
        console.log(`Pool Liquidity: ${ethers.formatEther(liquidity)}`);
        console.log(`Pool Fee: ${fee} (basis points)`);
        console.log(`Pool Tokens: token0=${token0}, token1=${token1}`);
        console.log(`USDC Balance in Pool: ${ethers.formatUnits(usdcBalance, 6)} USDC`);
        return { poolAddress, fee, liquidity: liquidity > 0 };
    } catch (error) {
        console.error("Error checking liquidity pool:", error.message);
        return null;
    }
}

async function approveToken(tokenContract, tokenName, amount, tokenDecimals) {
    try {
        const allowance = await tokenContract.allowance(wallet.address, QUICKSWAP_ADDRESS);
        console.log(`${tokenName} Allowance: ${ethers.formatUnits(allowance, tokenDecimals)}`);
        if (allowance < amount) {
            console.log(`Approving ${tokenName}...`);
            const maxApproval = ethers.MaxUint256;
            const approveTx = await tokenContract.approve(QUICKSWAP_ADDRESS, maxApproval, { gasLimit: 100000 });
            await approveTx.wait();
            console.log(`Approved ${tokenName}: ${approveTx.hash}`);
        }
    } catch (error) {
        console.error(`Error approving ${tokenName}:`, error);
        throw error;
    }
}

async function wrapSTT(amount) {
    const wsttContract = tokenContracts["WSTT"];
    console.log(`Wrapping ${ethers.formatEther(amount)} STT to WSTT...`);
    const depositTx = await wsttContract.deposit({ value: amount, gasLimit: 100000 });
    await depositTx.wait();
    console.log(`Wrapped STT to WSTT: ${depositTx.hash}`);
}

async function swapTokens(tokenInKey, tokenOutKey, amountIn, factory) {
    const tokenIn = TOKENS[tokenInKey];
    const tokenOut = TOKENS[tokenOutKey];
    const amount = ethers.parseUnits(amountIn.toString(), tokenIn.decimals);

    let tokenInAddress = tokenIn.address;
    let balance;

    if (tokenIn.isNative) {
        balance = await provider.getBalance(wallet.address);
        console.log(`STT Balance: ${ethers.formatEther(balance)}`);
        if (balance < amount) {
            throw new Error(`Insufficient STT balance: ${ethers.formatEther(balance)}, required: ${ethers.formatEther(amount)}`);
        }
        await wrapSTT(amount);
        tokenInAddress = TOKENS["WSTT"].address;
    } else {
        balance = await tokenContracts[tokenInKey].balanceOf(wallet.address);
        console.log(`${tokenIn.symbol} Balance: ${ethers.formatUnits(balance, tokenIn.decimals)}`);
        if (balance < amount) {
            throw new Error(`Insufficient ${tokenIn.symbol} balance: ${ethers.formatUnits(balance, tokenIn.decimals)}`);
        }
    }

    await approveToken(tokenContracts[tokenIn.isNative ? "WSTT" : tokenInKey], tokenIn.isNative ? "WSTT" : tokenIn.symbol, amount, tokenIn.decimals);

    const wNativeToken = await quickSwapContract.WNativeToken();
    const tokenOutAddress = tokenOut.isNative ? wNativeToken : tokenOut.address;

    const poolInfo = await checkLiquidityPool(factory, tokenInAddress, tokenOutAddress, 3000);
    if (!poolInfo || !poolInfo.liquidity) {
        throw new Error(`No viable liquidity pool for ${tokenIn.symbol} > ${tokenOut.symbol} with fee tier 3000`);
    }
    const { poolAddress } = poolInfo;

    // Get current price from pool
    const price = await getPoolPrice(poolAddress);
    const amountOutExpected = price * Number(amountIn);
    let amountOutMinimum = ethers.parseUnits(amountOutExpected.toFixed(6), tokenOut.decimals);
    // Apply 0.5% slippage tolerance
    amountOutMinimum = amountOutMinimum * BigInt(995) / BigInt(1000);
    console.log(`Expected output: ${amountOutExpected} ${tokenOut.symbol}, Minimum with slippage: ${ethers.formatUnits(amountOutMinimum, tokenOut.decimals)} ${tokenOut.symbol}`);

    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const params = {
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        deployer: "0x0000000000000000000000000000000000000000",
        recipient: wallet.address,
        deadline: deadline,
        amountIn: amount,
        amountOutMinimum: amountOutMinimum,
        limitSqrtPrice: 0
    };

    console.log("Swap Parameters:", JSON.stringify(params, (key, value) => typeof value === 'bigint' ? value.toString() : value));

    const overrides = { gasLimit: 250000 };

    console.log("Simulating transaction...");
    const tx = await quickSwapContract.exactInputSingle.populateTransaction(params, overrides);
    try {
        await provider.call(tx);
        console.log("Simulation successful");
    } catch (simError) {
        console.error("Simulation failed:", simError.message);
        if (simError.data) {
            console.error("Simulation revert data:", simError.data);
        }
        throw simError;
    }

    const swapTx = await quickSwapContract.exactInputSingle(params, overrides);
    const receipt = await swapTx.wait();
    console.log(`Swapped ${tokenIn.symbol} to ${tokenOut.symbol}: ${swapTx.hash}`);
}

async function performQuickSwap(wallet, tokenInKey, tokenOutKey, amountIn, provider) {
    try {
        console.log(`\n=== Starting QuickSwap: ${tokenInKey} to ${tokenOutKey} ===`);
        console.log("Wallet Address:", wallet.address);

        const tokenInInfo = TOKENS[tokenInKey];
        const tokenOutInfo = TOKENS[tokenOutKey];
        const wNativeTokenAddress = await quickSwapContract.WNativeToken();

        console.log(`Swap Details:
            From: ${tokenInInfo.symbol} (${tokenInInfo.isNative ? 'Native' : tokenInInfo.address})
            To: ${tokenOutInfo.symbol} (${tokenOutInfo.isNative ? 'Native' : tokenOutInfo.address})
            Amount: ${ethers.formatUnits(amountIn, tokenInInfo.decimals)} ${tokenInInfo.symbol}`);

        const sttBalance = await provider.getBalance(wallet.address);
        console.log(`STT Balance (for gas): ${ethers.formatEther(sttBalance)}`);
        if (sttBalance < ethers.parseUnits(MIN_GAS_BALANCE, 18)) {
            throw new Error(`Insufficient STT for gas: ${ethers.formatEther(sttBalance)}`);
        }

        const { factory } = await logContractDetails();

        const tokenInAddress = tokenInInfo.isNative ? wNativeTokenAddress : tokenInInfo.address;
        const tokenOutAddress = tokenOutInfo.isNative ? wNativeTokenAddress : tokenOutInfo.address;

        console.log(`\nChecking liquidity for ${tokenInKey} > ${tokenOutKey}...`);
        const poolInfo = await checkLiquidityPool(factory, tokenInAddress, tokenOutAddress, 3000);
        if (!poolInfo) {
            throw new Error(`No viable liquidity pool for ${tokenInKey} > ${tokenOutKey}`);
        }
        console.log(`Liquidity pool found: ${poolInfo.poolAddress}`);

        await swapTokens(tokenInKey, tokenOutKey, ethers.formatUnits(amountIn, tokenInInfo.decimals), factory);

        console.log(`\n=== Swap Completed: ${tokenInKey} to ${tokenOutKey} ===`);
        console.log("Final Balances:");
        for (const tokenKey in TOKENS) {
            const token = TOKENS[tokenKey];
            if (token.isNative) {
                const balance = await provider.getBalance(wallet.address);
                console.log(`  ${token.symbol}: ${ethers.formatEther(balance)}`);
            } else {
                const balance = await tokenContracts[tokenKey].balanceOf(wallet.address);
                console.log(`  ${token.symbol}: ${ethers.formatUnits(balance, token.decimals)}`);
            }
        }
    } catch (error) {
        console.error(`\n=== Error in QuickSwap: ${tokenInKey} to ${tokenOutKey} ===`);
        console.error(error.message);
        throw error;
    }
}

module.exports = { performQuickSwap };