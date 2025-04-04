require('dotenv').config();
const ethers = require('ethers');

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.MAIN_PRIVATE_KEY, provider);

const QUICKSWAP_ADDRESS = "0xE94de02e52Eaf9F0f6Bf7f16E4927FcBc2c09bC7";
const FACTORY_ADDRESS = "0x0BFaCE9a5c9F884a4f09fadB83b69e81EA41424B";
const MIN_GAS_BALANCE = process.env.MIN_GAS_BALANCE || "0.01";
const KNOWN_POOL_ADDRESS = "0xdc62e0a2Be944672E48aE4860e6Dfc727362B8E0";

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

const PoolAddressABI = [
    {
        "inputs": [
            { "internalType": "address", "name": "deployer", "type": "address" },
            { "internalType": "address", "name": "tokenA", "type": "address" },
            { "internalType": "address", "name": "tokenB", "type": "address" }
        ],
        "name": "computeAddress",
        "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
        "stateMutability": "pure",
        "type": "function"
    }
];

const poolAbi = [
    "function globalState() external view returns (uint160, int24, uint16, uint16, uint16, uint8, uint8, bool)",
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
    try {
        const globalState = await poolContract.globalState();
        const sqrtPriceX96 = globalState[0]; // First return value is price
        const price = (Number(sqrtPriceX96) ** 2) / (2 ** 192) * (10 ** 12); // WSTT/USDC (18 - 6 decimals)
        console.log(`Current pool price: 1 WSTT = ${price} USDC`);
        return price;
    } catch (error) {
        console.error("Failed to fetch pool price:", error.message);
        console.log("Falling back to static minimum output with higher slippage");
        return 0.14554 * 0.95; // 5% slippage from manual swap rate
    }
}

async function checkLiquidityPool(factoryAddress, tokenInAddress, tokenOutAddress, feeTier = 111) {
    let poolAddress;
    try {
        const factoryContract = new ethers.Contract(factoryAddress, factoryAbi, provider);
        poolAddress = await factoryContract.getPool(tokenInAddress, tokenOutAddress, feeTier);
        console.log(`Liquidity Pool for ${tokenInAddress} - ${tokenOutAddress} (Fee ${feeTier}): ${poolAddress}`);
        if (poolAddress === ethers.ZeroAddress) {
            throw new Error("No pool found via getPool");
        }
    } catch (error) {
        console.log(`No pool found for fee tier ${feeTier} via factory. Falling back to known pool address.`);
        poolAddress = KNOWN_POOL_ADDRESS;
    }

    const poolContract = new ethers.Contract(poolAddress, poolAbi, provider);
    try {
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
        console.error("Error verifying pool:", error.message);
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

async function swapTokens(tokenInKey, tokenOutKey, amountToSwap, poolDeployer, factory) {
    const tokenIn = TOKENS[tokenInKey];
    const tokenOut = TOKENS[tokenOutKey];
    const amountIn = ethers.parseUnits(amountToSwap.toString(), tokenIn.decimals);

    let tokenInAddress = tokenIn.address;
    let balance;

    if (tokenInKey === "WSTT") {
        balance = await tokenContracts["WSTT"].balanceOf(wallet.address);
        console.log(`WSTT Balance: ${ethers.formatUnits(balance, 18)}`);
        console.log(`Required WSTT: ${ethers.formatUnits(amountIn, 18)}`);
        if (balance < amountIn) {
            console.log(`Insufficient WSTT balance: ${ethers.formatUnits(balance, 18)}, required: ${ethers.formatUnits(amountIn, 18)}`);
            const sttBalance = await provider.getBalance(wallet.address);
            console.log(`STT Balance: ${ethers.formatEther(sttBalance)}`);
            if (sttBalance < amountIn) {
                throw new Error(`Insufficient STT balance to wrap: ${ethers.formatEther(sttBalance)}, required: ${ethers.formatEther(amountIn)}`);
            }
            console.log(`Wrapping ${ethers.formatEther(amountIn)} STT to WSTT...`);
            await wrapSTT(amountIn);
            balance = await tokenContracts["WSTT"].balanceOf(wallet.address);
            console.log(`New WSTT Balance after wrapping: ${ethers.formatUnits(balance, 18)}`);
        }
    } else if (tokenIn.isNative) {
        balance = await provider.getBalance(wallet.address);
        console.log(`STT Balance: ${ethers.formatEther(balance)}`);
        console.log(`Required STT: ${ethers.formatEther(amountIn)}`);
        if (balance < amountIn) {
            throw new Error(`Insufficient STT balance: ${ethers.formatEther(balance)}, required: ${ethers.formatEther(amountIn)}`);
        }
        console.log(`Wrapping ${ethers.formatEther(amountIn)} STT to WSTT...`);
        await wrapSTT(amountIn);
        tokenInAddress = TOKENS["WSTT"].address;
        balance = await tokenContracts["WSTT"].balanceOf(wallet.address);
        console.log(`New WSTT Balance after wrapping: ${ethers.formatUnits(balance, 18)}`);
    } else {
        balance = await tokenContracts[tokenInKey].balanceOf(wallet.address);
        console.log(`${tokenIn.symbol} Balance: ${ethers.formatUnits(balance, tokenIn.decimals)}`);
        if (balance < amountIn) {
            throw new Error(`Insufficient ${tokenIn.symbol} balance: ${ethers.formatUnits(balance, tokenIn.decimals)}, required: ${ethers.formatUnits(amountIn, tokenIn.decimals)}`);
        }
    }

    console.log(`Swapping ${ethers.formatUnits(amountIn, tokenIn.decimals)} ${tokenInKey === "STT" ? "WSTT (wrapped STT)" : tokenIn.symbol} to ${tokenOut.symbol}...`);

    await approveToken(tokenContracts[tokenInKey === "STT" ? "WSTT" : tokenInKey], tokenInKey === "STT" ? "WSTT" : tokenIn.symbol, amountIn, tokenIn.decimals);

    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const wNativeToken = await quickSwapContract.WNativeToken();
    const tokenOutAddress = tokenOut.isNative ? wNativeToken : tokenOut.address;

    const { fee } = await checkPoolLiquidity(factory, tokenInAddress, tokenOutAddress, tokenOut.decimals);
    console.log(`Pool Fee (actual): ${fee} bps, Expected: ${FEE_TIER} bps`);

    const expectedOut = await getExpectedOutput(factory, tokenInAddress, tokenOutAddress, amountIn, tokenIn.decimals, tokenOut.decimals);
    const manualAmountOutMinimum = ethers.parseUnits("0.013134", tokenOut.decimals); // Match your log’s minimum
    const amountOutMinimum = manualAmountOutMinimum;
    console.log(`Expected Output (calculated): ${ethers.formatUnits(expectedOut, tokenOut.decimals)} ${tokenOut.symbol}`);
    console.log(`Manual Expected Output: 0.0138263 ${tokenOut.symbol}`);
    console.log(`amountOutMinimum (manual, higher slippage): ${ethers.formatUnits(amountOutMinimum, tokenOut.decimals)} ${tokenOut.symbol}`);

    const params = {
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        deployer: poolDeployer, // Should be 0x15fCbF9...
        recipient: wallet.address,
        deadline: deadline,
        amountIn: amountIn,
        amountOutMinimum: amountOutMinimum,
        limitSqrtPrice: 0
    };

    console.log("Swap Parameters:", JSON.stringify(params, (key, value) => typeof value === 'bigint' ? value.toString() : value));

    // Compute and log the expected pool address
    const poolAddressContract = new ethers.Contract("0xE94de02e52Eaf9F0f6Bf7f16E4927FcBc2c09bC7", PoolAddressABI, provider);
    const computedPoolAddress = await poolAddressContract.computeAddress(
        poolDeployer,
        tokenInAddress < tokenOutAddress ? tokenInAddress : tokenOutAddress,
        tokenInAddress < tokenOutAddress ? tokenOutAddress : tokenInAddress
    );
    console.log(`Computed Pool Address: ${computedPoolAddress}`);
    console.log(`Actual Pool Address: 0xdc62e0a2Be944672E48aE4860e6Dfc727362B8E0`);

    const overrides = { gasLimit: 1000000 };

    try {
        const tx = await quickSwapContract.exactInputSingle.populateTransaction(params, overrides);
        console.log("Simulating transaction...");
        try {
            await provider.call(tx);
            console.log("Simulation successful");
        } catch (simError) {
            console.error("Simulation failed:", simError.message);
            if (simError.data) {
                console.error("Simulation revert data:", simError.data);
            }
        }

        const swapTx = await quickSwapContract.exactInputSingle(params, overrides);
        console.log("Raw TX:", JSON.stringify(swapTx, (key, value) => typeof value === 'bigint' ? value.toString() : value));
        const swapReceipt = await swapTx.wait();
        console.log(`Swapped ${tokenInKey === "STT" ? "WSTT (wrapped STT)" : tokenIn.symbol} to ${tokenOut.symbol}: ${swapTx.hash}`);

        if (tokenOut.isNative) {
            const wsttBalance = await tokenContracts["WSTT"].balanceOf(wallet.address);
            if (wsttBalance > 0) {
                await unwrapWSTT(wsttBalance);
            }
        }
    } catch (error) {
        if (error.code === 'CALL_EXCEPTION') {
            console.error("Revert Reason:", error.reason || "Unknown revert reason");
            if (error.data && error.data !== "0x") {
                try {
                    const decodedError = ethers.AbiCoder.defaultAbiCoder().decode(["string"], `0x${error.data.slice(10)}`);
                    console.error("Decoded Revert Reason:", decodedError[0]);
                } catch (decodeError) {
                    console.error("Failed to decode revert reason:", decodeError.message);
                    console.error("Raw Revert Data:", error.data);
                }
            } else {
                console.error("No revert data available");
            }
            console.error("Transaction:", JSON.stringify(error.transaction, (key, value) => typeof value === 'bigint' ? value.toString() : value));
            console.error("Receipt:", JSON.stringify(error.receipt, (key, value) => typeof value === 'bigint' ? value.toString() : value));
        }
        throw error;
    }
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
        const poolInfo = await checkLiquidityPool(factory, tokenInAddress, tokenOutAddress, 111);
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

async function wrapSTT(amount) {
    const wsttContract = tokenContracts["WSTT"];
    console.log(`Wrapping ${ethers.formatEther(amount)} STT to WSTT...`);
    const depositTx = await wsttContract.deposit({ value: amount, gasLimit: 100000 });
    await depositTx.wait();
    console.log(`Wrapped STT to WSTT: ${depositTx.hash}`);
}

module.exports = { performQuickSwap };