require('dotenv').config();
const ethers = require('ethers');

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.MAIN_PRIVATE_KEY, provider);

const QUICKSWAP_ADDRESS = "0xE94de02e52Eaf9F0f6Bf7f16E4927FcBc2c09bC7";
const FEE_TIER = parseInt(process.env.FEE_TIER) || 500;
const MIN_GAS_BALANCE = process.env.MIN_GAS_BALANCE || "0.01";

const TOKENS = {
    STT: { address: null, symbol: "STT", decimals: 18, isNative: true },
    WSTT: { address: "0x4A3BC48C156384f9564Fd65A53a2f3D534D8f2b7", symbol: "WSTT", decimals: 18, isNative: false },
    USDC: { address: "0xE9CC37904875B459Fa5D0FE37680d36F1ED55e38", symbol: "USDC", decimals: 6, isNative: false },
    WETH: { address: "0xd2480162Aa7F02Ead7BF4C127465446150D58452", symbol: "WETH", decimals: 18, isNative: false }
};

if (!QUICKSWAP_ADDRESS) {
    throw new Error("Missing required environment variable: QUICKSWAP_ADDRESS");
}

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
    { "inputs": [], "name": "poolDeployer", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "factory", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" }
];

const factoryAbi = [
    {
        "inputs": [
            { "internalType": "address", "name": "tokenA", "type": "address" },
            { "internalType": "address", "name": "tokenB", "type": "address" }
        ],
        "name": "poolByPair",
        "outputs": [{ "internalType": "address", "name": "pool", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    }
];

const poolAbi = [
    "function globalState() external view returns (uint160 price, int24 tick, uint16 feeZto, uint16 feeOtz, uint16 timepointIndex, uint8 communityFee)",
    "function fee() external view returns (uint24)",
    "function liquidity() external view returns (uint128)"
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
        const poolDeployer = await quickSwapContract.poolDeployer();
        console.log(`Pool Deployer Address: ${poolDeployer}`);
        const factory = await quickSwapContract.factory();
        console.log(`Factory Address: ${factory}`);
        return { poolDeployer, factory };
    } catch (error) {
        console.error("Error fetching contract details:", error.message);
        throw error;
    }
}

async function checkLiquidityPool(factoryAddress, tokenInAddress, tokenOutAddress) {
    try {
        const factoryContract = new ethers.Contract(factoryAddress, factoryAbi, provider);
        const poolAddress = await factoryContract.poolByPair(tokenInAddress, tokenOutAddress);
        console.log(`Liquidity Pool for ${tokenInAddress} - ${tokenOutAddress}: ${poolAddress}`);
        return poolAddress !== ethers.ZeroAddress ? poolAddress : null;
    } catch (error) {
        console.error("Error checking liquidity pool:", error.message);
        return null;
    }
}

async function checkPoolLiquidity(factoryAddress, tokenInAddress, tokenOutAddress, tokenOutDecimals) {
    const poolAddress = await checkLiquidityPool(factoryAddress, tokenInAddress, tokenOutAddress);
    if (!poolAddress) throw new Error("No pool found");
    const poolContract = new ethers.Contract(poolAddress, poolAbi, provider);
    const globalState = await poolContract.globalState();
    const fee = await poolContract.fee();
    const liquidity = await poolContract.liquidity();
    const sqrtPriceX96 = globalState[0];
    console.log(`Pool sqrtPriceX96: ${sqrtPriceX96.toString()}`);
    console.log(`Pool Fee Tier: ${fee} (bps)`);
    console.log(`Pool Liquidity: ${liquidity.toString()}`);
    const usdcBalance = await tokenContracts["USDC"].balanceOf(poolAddress);
    console.log(`USDC Balance in Pool: ${ethers.formatUnits(usdcBalance, 6)} USDC`);
    if (sqrtPriceX96 === 0n) {
        throw new Error("Pool has no liquidity (sqrtPriceX96 = 0)");
    }
    return { poolAddress, sqrtPriceX96, fee };
}

async function getExpectedOutput(factoryAddress, tokenInAddress, tokenOutAddress, amountIn, tokenInDecimals, tokenOutDecimals) {
    const { sqrtPriceX96, fee } = await checkPoolLiquidity(factoryAddress, tokenInAddress, tokenOutAddress, tokenOutDecimals);
    const sqrtPriceX96Big = BigInt(sqrtPriceX96);
    const numerator = sqrtPriceX96Big * sqrtPriceX96Big * BigInt(10 ** (tokenOutDecimals + tokenInDecimals));
    const denominator = (BigInt(2) ** BigInt(192)) * BigInt(10 ** tokenInDecimals);

    let price;
    if (tokenInAddress < tokenOutAddress) {
        if (numerator === 0n) throw new Error("Numerator is zero, cannot calculate price");
        price = denominator / numerator; // USDC/WSTT
        console.log(`Calculated Price (USDC/WSTT): ${ethers.formatUnits(price, tokenOutDecimals)}`);
    } else {
        price = numerator / denominator; // WSTT/USDC
        console.log(`Calculated Price (WSTT/USDC): ${ethers.formatUnits(price, tokenOutDecimals)}`);
    }

    if (price === 0n) throw new Error("Calculated price is zero, cannot proceed with swap");

    const feeBigInt = BigInt(fee);
    const feeMultiplier = BigInt(10000) - feeBigInt;
    const amountOut = (amountIn * price * feeMultiplier) / (BigInt(10000) * BigInt(10 ** tokenInDecimals));
    console.log(`Fee Multiplier: ${feeMultiplier}`);
    console.log(`Raw amountOut: ${amountOut.toString()}`);
    return amountOut;
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

async function unwrapWSTT(amount) {
    const wsttContract = tokenContracts["WSTT"];
    console.log(`Unwrapping ${ethers.formatUnits(amount, 18)} WSTT to STT...`);
    const withdrawTx = await wsttContract.withdraw(amount, { gasLimit: 100000 });
    await withdrawTx.wait();
    console.log(`Unwrapped WSTT to STT: ${withdrawTx.hash}`);
}

async function swapTokens(tokenInKey, tokenOutKey, amountToSwap, poolDeployer, factory) {
    let tokenInKeyForSwap = tokenInKey;
    const tokenIn = TOKENS[tokenInKey];
    const tokenOut = TOKENS[tokenOutKey];
    const amountIn = ethers.parseUnits(amountToSwap.toString(), tokenIn.decimals);

    let balance;
    if (tokenInKey === "WSTT") {
        balance = await tokenContracts["WSTT"].balanceOf(wallet.address);
        console.log(`WSTT Balance: ${ethers.formatUnits(balance, 18)}`);
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
        tokenInKeyForSwap = "WSTT";
    } else if (tokenIn.isNative) {
        balance = await provider.getBalance(wallet.address);
        console.log(`STT Balance: ${ethers.formatEther(balance)}`);
        if (balance < amountIn) {
            throw new Error(`Insufficient STT balance: ${ethers.formatEther(balance)}, required: ${ethers.formatEther(amountIn)}`);
        }
        await wrapSTT(amountIn);
        tokenInKeyForSwap = "WSTT";
    } else {
        balance = await tokenContracts[tokenInKey].balanceOf(wallet.address);
        console.log(`${tokenIn.symbol} Balance: ${ethers.formatUnits(balance, tokenIn.decimals)}`);
        if (balance < amountIn) {
            throw new Error(`Insufficient ${tokenIn.symbol} balance: ${ethers.formatUnits(balance, tokenIn.decimals)}, required: ${ethers.formatUnits(amountIn, tokenIn.decimals)}`);
        }
    }

    console.log(`Swapping ${ethers.formatUnits(amountIn, TOKENS[tokenInKeyForSwap].decimals)} ${TOKENS[tokenInKeyForSwap].symbol} to ${tokenOut.symbol}...`);

    await approveToken(tokenContracts[tokenInKeyForSwap], TOKENS[tokenInKeyForSwap].symbol, amountIn, TOKENS[tokenInKeyForSwap].decimals);

    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const wNativeToken = await quickSwapContract.WNativeToken();
    const tokenInAddress = TOKENS[tokenInKeyForSwap].address;
    const tokenOutAddress = tokenOut.isNative ? wNativeToken : tokenOut.address;

    const expectedOut = await getExpectedOutput(factory, tokenInAddress, tokenOutAddress, amountIn, TOKENS[tokenInKeyForSwap].decimals, tokenOut.decimals);
    const slippageTolerance = 0.005; // 0.5% to match manual swap
    const manualAmountOutMinimum = ethers.parseUnits("0.014544", tokenOut.decimals);
    const amountOutMinimum = manualAmountOutMinimum;
    console.log(`Expected Output (calculated): ${ethers.formatUnits(expectedOut, tokenOut.decimals)} ${tokenOut.symbol}`);
    console.log(`Manual Expected Output: 0.014617 ${tokenOut.symbol}`);
    console.log(`amountOutMinimum (manual, 0.5% slippage): ${ethers.formatUnits(amountOutMinimum, tokenOut.decimals)} ${tokenOut.symbol}`);

    const params = {
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        deployer: poolDeployer,
        recipient: wallet.address,
        deadline: deadline,
        amountIn: amountIn,
        amountOutMinimum: amountOutMinimum,
        limitSqrtPrice: 0
    };

    console.log("Swap Parameters:", JSON.stringify(params, (key, value) => typeof value === 'bigint' ? value.toString() : value));

    const overrides = { gasLimit: 1000000 };

    try {
        const swapTx = await quickSwapContract.exactInputSingle(params, overrides);
        console.log("Raw TX:", JSON.stringify(swapTx, (key, value) => typeof value === 'bigint' ? value.toString() : value));
        const swapReceipt = await swapTx.wait();
        console.log(`Swapped ${TOKENS[tokenInKeyForSwap].symbol} to ${tokenOut.symbol}: ${swapTx.hash}`);

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

async function performQuickSwap(wallet, tokenIn, tokenOut, amountIn, provider) {
    try {
        if (!wallet || !tokenIn || !tokenOut || amountIn === undefined || !provider) {
            throw new Error(`Missing required parameters: ${
                [!wallet && 'wallet', !tokenIn && 'tokenIn', !tokenOut && 'tokenOut', amountIn === undefined && 'amountIn', !provider && 'provider'].filter(Boolean).join(', ')
            }`);
        }

        console.log("\n=== Starting QuickSwap ===");
        console.log("Wallet Address:", wallet.address);

        const wNativeTokenAddress = await quickSwapContract.WNativeToken();
        console.log("WNativeToken Address:", wNativeTokenAddress);

        const tokenInKey = Object.keys(TOKENS).find(key => 
            (TOKENS[key].address && TOKENS[key].address.toLowerCase() === tokenIn.toLowerCase()) ||
            (TOKENS[key].isNative && tokenIn.toLowerCase() === wNativeTokenAddress.toLowerCase())
        );
        
        const tokenOutKey = Object.keys(TOKENS).find(key => 
            (TOKENS[key].address && TOKENS[key].address.toLowerCase() === tokenOut.toLowerCase()) ||
            (TOKENS[key].isNative && tokenOut.toLowerCase() === wNativeTokenAddress.toLowerCase())
        );

        if (!tokenInKey || !tokenOutKey) {
            throw new Error(`Token not found in configuration. Input Tokens: ${tokenIn}, ${tokenOut}, Available Tokens: ${Object.keys(TOKENS).join(', ')}`);
        }

        const tokenInInfo = TOKENS[tokenInKey];
        const tokenOutInfo = TOKENS[tokenOutKey];

        console.log(`\nSwap Details:
            From: ${tokenInInfo.symbol} (${tokenIn})
            To: ${tokenOutInfo.symbol} (${tokenOut})
            Amount: ${ethers.formatUnits(amountIn, tokenInInfo.decimals)} ${tokenInInfo.symbol}`);

        const sttBalance = await provider.getBalance(wallet.address);
        console.log(`\nBalances:
            STT: ${ethers.formatEther(sttBalance)} (gas token)
            Minimum Required: ${MIN_GAS_BALANCE}`);

        if (sttBalance < ethers.parseUnits(MIN_GAS_BALANCE, 18)) {
            throw new Error(`Insufficient STT for gas. Have: ${ethers.formatEther(sttBalance)}, Need: ${MIN_GAS_BALANCE}`);
        }

        const { poolDeployer, factory } = await logContractDetails();

        const tokenInAddress = tokenInInfo.isNative ? wNativeTokenAddress : tokenInInfo.address;
        const tokenOutAddress = tokenOutInfo.isNative ? wNativeTokenAddress : tokenOutInfo.address;

        const poolAddress = await checkLiquidityPool(factory, tokenInAddress, tokenOutAddress);
        if (!poolAddress) {
            throw new Error(`No liquidity pool for ${tokenInInfo.symbol}/${tokenOutInfo.symbol} pair`);
        }

        const amountToSwap = ethers.formatUnits(amountIn, tokenInInfo.decimals);

        console.log("\nExecuting swap...");
        await swapTokens(tokenInKey, tokenOutKey, amountToSwap, poolDeployer, factory);

        console.log("\n=== Swap Completed Successfully ===");
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
        console.error("\n=== Critical Error in performQuickSwap ===");
        console.error(error);
        throw error;
    }
}

module.exports = { performQuickSwap };