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
    {
        "inputs": [
            {
                "components": [
                    { "internalType": "bytes", "name": "path", "type": "bytes" },
                    { "internalType": "address", "name": "recipient", "type": "address" },
                    { "internalType": "uint256", "name": "deadline", "type": "uint256" },
                    { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
                    { "internalType": "uint256", "name": "amountOutMinimum", "type": "uint256" }
                ],
                "internalType": "struct ISwapRouter.ExactInputParams",
                "name": "params",
                "type": "tuple"
            }
        ],
        "name": "exactInput",
        "outputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }],
        "stateMutability": "payable",
        "type": "function"
    },
    { "inputs": [], "name": "WNativeToken", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "poolDeployer", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "factory", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
    { "inputs": [], "name": "refundNativeToken", "outputs": [], "stateMutability": "payable", "type": "function" }
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
    "function globalState() external view returns (uint160 price, int24 tick, uint16 feeZto, uint16 feeOtz, uint16 timepointIndex, uint8 communityFee)"
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
    const sqrtPriceX96 = globalState[0];
    console.log(`Pool sqrtPriceX96: ${sqrtPriceX96.toString()}`);
    if (sqrtPriceX96 === 0n) {
        throw new Error("Pool has no liquidity (sqrtPriceX96 = 0)");
    }
    return { poolAddress, sqrtPriceX96 };
}

async function getExpectedOutput(factoryAddress, tokenInAddress, tokenOutAddress, amountIn, tokenInDecimals, tokenOutDecimals) {
    const { sqrtPriceX96 } = await checkPoolLiquidity(factoryAddress, tokenInAddress, tokenOutAddress, tokenOutDecimals);
    const sqrtPriceX96Big = BigInt(sqrtPriceX96);
    // Price in Q64.96: price = (sqrtPriceX96^2 / 2^192)
    const priceRaw = (sqrtPriceX96Big * sqrtPriceX96Big) / (BigInt(2) ** BigInt(192));
    
    // Adjust for token decimals and order
    let price;
    if (tokenInAddress < tokenOutAddress) {
        // tokenIn = token0 (WSTT), tokenOut = token1 (USDC), priceRaw is token0/token1 (WSTT/USDC)
        // We need USDC/WSTT, so invert and adjust decimals
        price = (BigInt(10 ** tokenInDecimals) * BigInt(10 ** tokenOutDecimals)) / priceRaw;
        console.log(`Calculated Price (USDC/WSTT): ${ethers.formatUnits(price, tokenOutDecimals)}`);
    } else {
        // tokenIn = token1, tokenOut = token0, priceRaw is token0/token1, no inversion needed
        price = priceRaw * BigInt(10 ** tokenOutDecimals) / BigInt(10 ** tokenInDecimals);
        console.log(`Calculated Price (WSTT/USDC): ${ethers.formatUnits(price, tokenOutDecimals)}`);
    }

    // Calculate amountOut = amountIn * (USDC/WSTT price)
    const amountOut = (amountIn * BigInt(10 ** tokenOutDecimals)) / price;
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
    if (tokenIn.isNative) {
        balance = await provider.getBalance(wallet.address);
    } else {
        balance = await tokenContracts[tokenInKey].balanceOf(wallet.address);
    }
    if (balance < amountIn) {
        throw new Error(`Insufficient ${tokenIn.symbol} balance: ${ethers.formatUnits(balance, tokenIn.decimals)} ${tokenIn.symbol}, required: ${ethers.formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol}`);
    }

    if (tokenIn.isNative) {
        await wrapSTT(amountIn);
        tokenInKeyForSwap = "WSTT";
    }

    console.log(`Swapping ${ethers.formatUnits(amountIn, TOKENS[tokenInKeyForSwap].decimals)} ${TOKENS[tokenInKeyForSwap].symbol} to ${tokenOut.symbol}...`);

    await approveToken(tokenContracts[tokenInKeyForSwap], TOKENS[tokenInKeyForSwap].symbol, amountIn, TOKENS[tokenInKeyForSwap].decimals);

    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const wNativeToken = await quickSwapContract.WNativeToken();
    const tokenInAddress = TOKENS[tokenInKeyForSwap].address;
    const tokenOutAddress = tokenOut.isNative ? wNativeToken : tokenOut.address;

    const expectedOut = await getExpectedOutput(factory, tokenInAddress, tokenOutAddress, amountIn, TOKENS[tokenInKeyForSwap].decimals, tokenOut.decimals);
    const slippageTolerance = 0.995; // 0.5% slippage
    const amountOutMinimum = BigInt(Math.floor(Number(expectedOut) * slippageTolerance));
    console.log(`Expected Output: ${ethers.formatUnits(expectedOut, tokenOut.decimals)} ${tokenOut.symbol}`);
    console.log(`amountOutMinimum with 0.5% slippage: ${ethers.formatUnits(amountOutMinimum, tokenOut.decimals)} ${tokenOut.symbol}`);

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

    console.log("Swap Parameters:", params);

    const overrides = { gasLimit: 1000000 };

    try {
        const swapTx = await quickSwapContract.exactInputSingle(params, overrides);
        console.log("Raw TX:", swapTx);
        const swapReceipt = await swapTx.wait();
        console.log(`Swapped ${TOKENS[tokenInKeyForSwap].symbol} to ${tokenOut.symbol}: ${swapTx.hash}`);

        if (tokenOut.isNative) {
            const wsttBalance = await tokenContracts["WSTT"].balanceOf(wallet.address);
            if (wsttBalance > 0) {
                await unwrapWSTT(wsttBalance);
            }
        }
    } catch (error) {
        if (error.code === 'CALL_EXCEPTION' && tokenOutKey === "WETH") {
            console.log("Single-hop swap failed, trying multi-hop swap (WSTT -> USDC -> WETH)...");
            const pool1 = await checkLiquidityPool(factory, TOKENS["WSTT"].address, TOKENS["USDC"].address);
            const pool2 = await checkLiquidityPool(factory, TOKENS["USDC"].address, TOKENS["WETH"].address);
            if (!pool1 || !pool2) {
                throw new Error("No liquidity pool exists for multi-hop path (WSTT -> USDC -> WETH)");
            }

            const path = ethers.solidityPacked(
                ["address", "address", "address"],
                [TOKENS["WSTT"].address, TOKENS["USDC"].address, TOKENS["WETH"].address]
            );

            const multiHopParams = {
                path: path,
                recipient: wallet.address,
                deadline: deadline,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum
            };

            try {
                const swapTx = await quickSwapContract.exactInput(multiHopParams, overrides);
                const swapReceipt = await swapTx.wait();
                console.log(`Swapped ${TOKENS[tokenInKeyForSwap].symbol} to ${tokenOut.symbol} via multi-hop: ${swapTx.hash}`);
                if (tokenOut.isNative) {
                    const wsttBalance = await tokenContracts["WSTT"].balanceOf(wallet.address);
                    if (wsttBalance > 0) {
                        await unwrapWSTT(wsttBalance);
                    }
                }
            } catch (multiHopError) {
                if (multiHopError.code === 'CALL_EXCEPTION' && params.deployer !== factory) {
                    console.log("Multi-hop swap failed with poolDeployer, retrying with factory address...");
                    multiHopParams.deployer = factory;
                    const swapTx = await quickSwapContract.exactInput(multiHopParams, overrides);
                    const swapReceipt = await swapTx.wait();
                    console.log(`Swapped ${TOKENS[tokenInKeyForSwap].symbol} to ${tokenOut.symbol} via multi-hop: ${swapTx.hash}`);
                    if (tokenOut.isNative) {
                        const wsttBalance = await tokenContracts["WSTT"].balanceOf(wallet.address);
                        if (wsttBalance > 0) {
                            await unwrapWSTT(wsttBalance);
                        }
                    }
                } else {
                    throw multiHopError;
                }
            }
        } else {
            throw error;
        }
    }
}

async function performQuickSwap(tokenInKey, tokenOutKey, amountToSwap) {
    console.log("Wallet Address:", wallet.address);

    const sttBalance = await provider.getBalance(wallet.address);
    console.log(`STT Balance: ${ethers.formatEther(sttBalance)} STT`);
    if (sttBalance < ethers.parseUnits(MIN_GAS_BALANCE, 18)) {
        throw new Error(`Insufficient STT balance for gas fees: ${ethers.formatEther(sttBalance)} STT, required: ${MIN_GAS_BALANCE} STT`);
    }

    for (const tokenKey in TOKENS) {
        const token = TOKENS[tokenKey];
        if (token.isNative) {
            console.log(`${token.symbol} Balance: ${ethers.formatEther(sttBalance)}`);
        } else {
            const balance = await tokenContracts[tokenKey].balanceOf(wallet.address);
            console.log(`${token.symbol} Balance: ${ethers.formatUnits(balance, token.decimals)}`);
        }
    }

    const { poolDeployer, factory } = await logContractDetails();

    const tokenIn = TOKENS[tokenInKey];
    const tokenOut = TOKENS[tokenOutKey];
    const wNativeToken = await quickSwapContract.WNativeToken();
    const tokenInAddress = tokenIn.isNative ? wNativeToken : tokenIn.address;
    const tokenOutAddress = tokenOut.isNative ? wNativeToken : tokenOut.address;

    const poolAddress = await checkLiquidityPool(factory, tokenInAddress, tokenOutAddress);
    if (!poolAddress) {
        throw new Error(`No liquidity pool exists for ${tokenInAddress}-${tokenOutAddress} (${tokenIn.symbol}-${tokenOut.symbol}) on QuickSwap.`);
    }

    try {
        await swapTokens(tokenInKey, tokenOutKey, amountToSwap, poolDeployer, factory);

        console.log("\nUpdated Balances After Swap:");
        for (const tokenKey in TOKENS) {
            const token = TOKENS[tokenKey];
            if (token.isNative) {
                const sttBalanceAfter = await provider.getBalance(wallet.address);
                console.log(`${token.symbol} Balance: ${ethers.formatEther(sttBalanceAfter)}`);
            } else {
                const balance = await tokenContracts[tokenKey].balanceOf(wallet.address);
                console.log(`${token.symbol} Balance: ${ethers.formatUnits(balance, token.decimals)}`);
            }
        }
    } catch (error) {
        if (error.code === 'CALL_EXCEPTION') {
            console.error("Revert Reason:", error.reason || "Unknown revert reason");
            if (error.data) {
                try {
                    const decodedError = ethers.AbiCoder.defaultAbiCoder().decode(["string"], `0x${error.data.slice(10)}`);
                    console.error("Decoded Revert Reason:", decodedError[0]);
                } catch (decodeError) {
                    console.error("Failed to decode revert reason:", decodeError.message);
                }
            }
            console.error("Transaction:", error.transaction);
            console.error("Receipt:", error.receipt);
        } else {
            console.error("Unexpected Error:", error);
        }
        throw error;
    }
}

module.exports = { performQuickSwap };