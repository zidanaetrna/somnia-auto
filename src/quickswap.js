require('dotenv').config();
const ethers = require('ethers');

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.MAIN_PRIVATE_KEY, provider);

const QUICKSWAP_ADDRESS = "0xE94de02e52Eaf9F0f6Bf7f16E4927FcBc2c09bC7"; // QuickSwap router contract address
const FEE_TIER = parseInt(process.env.FEE_TIER) || 500;
const MIN_GAS_BALANCE = process.env.MIN_GAS_BALANCE || "0.01";
const SLIPPAGE_TOLERANCE = 0.95; // 5% slippage tolerance

// Token addresses
const TOKENS = {
    STT: {
        address: null, // Native token, no address needed
        symbol: "STT",
        decimals: 18,
        isNative: true
    },
    WSTT: {
        address: "0x4A3BC48C156384f9564Fd65A53a2f3D534D8f2b7",
        symbol: "WSTT",
        decimals: 18,
        isNative: false
    },
    USDC: {
        address: "0xE9CC37904875B459Fa5D0FE37680d36F1ED55e38",
        symbol: "USDC",
        decimals: 6,
        isNative: false
    },
    WETH: {
        address: "0xd2480162Aa7F02Ead7BF4C127465446150D58452",
        symbol: "WETH",
        decimals: 18,
        isNative: false
    }
};

// Validate required environment variables
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
        "outputs": [
            { "internalType": "uint256", "name": "amountOut", "type": "uint256" }
        ],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "components": [
                    { "internalType": "bytes", "name": "path", "type": "bytes" },
                    { "internalType": "address", "name": "deployer", "type": "address" },
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
        "outputs": [
            { "internalType": "uint256", "name": "amountOut", "type": "uint256" }
        ],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "WNativeToken",
        "outputs": [
            { "internalType": "address", "name": "", "type": "address" }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "poolDeployer",
        "outputs": [
            { "internalType": "address", "name": "", "type": "address" }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "factory",
        "outputs": [
            { "internalType": "address", "name": "", "type": "address" }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "refundNativeToken",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    }
];

// Factory ABI for checking liquidity pools
const factoryAbi = [
    {
        "inputs": [
            { "internalType": "address", "name": "tokenA", "type": "address" },
            { "internalType": "address", "name": "tokenB", "type": "address" }
        ],
        "name": "poolByPair",
        "outputs": [
            { "internalType": "address", "name": "pool", "type": "address" }
        ],
        "stateMutability": "view",
        "type": "function"
    }
];

// Pool ABI to fetch price (simplified)
const poolAbi = [
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"
];

const quickSwapContract = new ethers.Contract(QUICKSWAP_ADDRESS, quickSwapAbi, wallet);

// Create token contracts for non-native tokens
const tokenContracts = {};
for (const tokenKey in TOKENS) {
    const token = TOKENS[tokenKey];
    if (!token.isNative) {
        tokenContracts[tokenKey] = new ethers.Contract(token.address, erc20Abi, wallet);
    }
}

// Debug: Fetch and log contract details
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

// Check if a liquidity pool exists for the token pair
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

// Estimate the output amount for slippage protection
async function estimateOutputAmount(poolAddress, tokenInAddress, tokenOutAddress, amountIn) {
    try {
        const poolContract = new ethers.Contract(poolAddress, poolAbi, provider);
        const slot0 = await poolContract.slot0();
        const sqrtPriceX96 = slot0.sqrtPriceX96;

        // Simplified price calculation (sqrtPriceX96^2 / 2^192)
        const price = (sqrtPriceX96 * sqrtPriceX96) / (BigInt(1) << 192n);
        const amountOut = (amountIn * price) / (BigInt(10) ** BigInt(18)); // Adjust for decimals (simplified)
        const amountOutMinimum = (amountOut * BigInt(Math.floor(SLIPPAGE_TOLERANCE * 1000))) / BigInt(1000);

        console.log(`Estimated Output (before slippage): ${ethers.formatUnits(amountOut, 18)} WETH`);
        console.log(`Amount Out Minimum (with ${100 - SLIPPAGE_TOLERANCE * 100}% slippage): ${ethers.formatUnits(amountOutMinimum, 18)} WETH`);

        return amountOutMinimum;
    } catch (error) {
        console.error("Error estimating output amount:", error.message);
        return BigInt(0);
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

    // Check balance
    let balance;
    if (tokenIn.isNative) {
        balance = await provider.getBalance(wallet.address);
    } else {
        balance = await tokenContracts[tokenInKey].balanceOf(wallet.address);
    }

    if (balance < amountIn) {
        throw new Error(`Insufficient ${tokenIn.symbol} balance: ${ethers.formatUnits(balance, tokenIn.decimals)} ${tokenIn.symbol}, required: ${ethers.formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol}`);
    }

    // If swapping from STT, wrap STT to WSTT first
    if (tokenIn.isNative) {
        await wrapSTT(amountIn);
        tokenInKeyForSwap = "WSTT";
    }

    console.log(`Swapping ${ethers.formatUnits(amountIn, TOKENS[tokenInKeyForSwap].decimals)} ${TOKENS[tokenInKeyForSwap].symbol} to ${tokenOut.symbol}...`);

    // Approve token (WSTT in case of STT, or the token itself otherwise)
    await approveToken(tokenContracts[tokenInKeyForSwap], TOKENS[tokenInKeyForSwap].symbol, amountIn, TOKENS[tokenInKeyForSwap].decimals);

    // Prepare swap parameters
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now
    const wNativeToken = await quickSwapContract.WNativeToken();
    const tokenInAddress = TOKENS[tokenInKeyForSwap].address;
    const tokenOutAddress = tokenOut.isNative ? wNativeToken : tokenOut.address;

    // Check liquidity and estimate output
    const poolAddress = await checkLiquidityPool(factory, tokenInAddress, tokenOutAddress);
    let amountOutMinimum = BigInt(0);
    if (poolAddress) {
        amountOutMinimum = await estimateOutputAmount(poolAddress, tokenInAddress, tokenOutAddress, amountIn);
    }

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

    // Try single-hop swap first
    try {
        const swapTx = await quickSwapContract.exactInputSingle(params, overrides);
        console.log("Raw TX:", swapTx);
        const swapReceipt = await swapTx.wait();
        console.log(`Swapped ${TOKENS[tokenInKeyForSwap].symbol} to ${tokenOut.symbol}: ${swapTx.hash}`);

        // If swapping to STT, unwrap WSTT to STT
        if (tokenOut.isNative) {
            const wsttBalance = await tokenContracts["WSTT"].balanceOf(wallet.address);
            if (wsttBalance > 0) {
                await unwrapWSTT(wsttBalance);
            }
        }
    } catch (error) {
        if (error.code === 'CALL_EXCEPTION') {
            console.log("Single-hop swap failed, trying multi-hop swap (WSTT -> USDC -> WETH)...");

            // Check liquidity for multi-hop path
            const pool1 = await checkLiquidityPool(factory, TOKENS["WSTT"].address, TOKENS["USDC"].address);
            const pool2 = await checkLiquidityPool(factory, TOKENS["USDC"].address, TOKENS["WETH"].address);

            if (!pool1 || !pool2) {
                throw new Error("No liquidity pool exists for multi-hop path (WSTT -> USDC -> WETH)");
            }

            // Encode the path: WSTT -> USDC -> WETH
            const path = ethers.solidityPacked(
                ["address", "address", "address"],
                [TOKENS["WSTT"].address, TOKENS["USDC"].address, TOKENS["WETH"].address]
            );

            const multiHopParams = {
                path: path,
                deployer: poolDeployer,
                recipient: wallet.address,
                deadline: deadline,
                amountIn: amountIn,
                amountOutMinimum: BigInt(0) // Simplified for now
            };

            console.log("Multi-Hop Swap Parameters:", multiHopParams);

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
                    console.log("Updated Multi-Hop Swap Parameters:", multiHopParams);
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

    // Check STT balance for gas fees
    const sttBalance = await provider.getBalance(wallet.address);
    console.log(`STT Balance: ${ethers.formatEther(sttBalance)} STT`);
    if (sttBalance < ethers.parseUnits(MIN_GAS_BALANCE, 18)) {
        throw new Error(`Insufficient STT balance for gas fees: ${ethers.formatEther(sttBalance)} STT, required: ${MIN_GAS_BALANCE} STT`);
    }

    // Log token balances
    for (const tokenKey in TOKENS) {
        const token = TOKENS[tokenKey];
        if (token.isNative) {
            console.log(`${token.symbol} Balance: ${ethers.formatEther(sttBalance)}`);
        } else {
            const balance = await tokenContracts[tokenKey].balanceOf(wallet.address);
            console.log(`${token.symbol} Balance: ${ethers.formatUnits(balance, token.decimals)}`);
        }
    }

    // Fetch contract details
    const { poolDeployer, factory } = await logContractDetails();

    // Check liquidity pool
    const tokenIn = TOKENS[tokenInKey];
    const tokenOut = TOKENS[tokenOutKey];
    const wNativeToken = await quickSwapContract.WNativeToken();
    const tokenInAddress = tokenIn.isNative ? wNativeToken : tokenIn.address;
    const tokenOutAddress = tokenOut.isNative ? wNativeToken : tokenOut.address;

    const poolAddress = await checkLiquidityPool(factory, tokenInAddress, tokenOutAddress);
    if (!poolAddress) {
        throw new Error(`No liquidity pool exists for ${tokenInAddress}-${tokenOutAddress} (${tokenIn.symbol}-${tokenOut.symbol}) on QuickSwap. Please try a different token pair.`);
    }

    // Perform the swap
    try {
        await swapTokens(tokenInKey, tokenOutKey, amountToSwap, poolDeployer, factory);

        // Log updated balances after swap
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
            console.error("Revert Reason:", error.reason || "Previous revert reason: Not WNativeToken (check contract or network)");
            console.error("Transaction:", error.transaction);
            console.error("Receipt:", error.receipt);

            // Attempt to fetch the revert reason manually
            try {
                const tx = error.transaction;
                const result = await provider.call(tx, tx.blockNumber);
                console.error("Manual Revert Reason:", result);
            } catch (callError) {
                console.error("Failed to fetch manual revert reason:", callError.message);
            }
        } else {
            console.error("Unexpected Error:", error);
        }
        throw error;
    }
}

module.exports = { performQuickSwap };