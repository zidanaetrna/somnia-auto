require('dotenv').config();
const ethers = require('ethers');

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.MAIN_PRIVATE_KEY, provider);

const QUICKSWAP_ADDRESS = "0xE94de02e52Eaf9F0f6Bf7f16E4927FcBc2c09bC7"; // QuickSwap router contract address
const FEE_TIER = parseInt(process.env.FEE_TIER) || 500;
const MIN_GAS_BALANCE = process.env.MIN_GAS_BALANCE || "0.01";

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
    "function decimals() external view returns (uint8)" // Added decimals function
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
            console.warn(`Warning: WNativeToken (${wNativeToken}) does not match expected WSTT address (${TOKENS.WSTT.address})`);
        }

        const poolDeployer = await quickSwapContract.poolDeployer();
        console.log(`Pool Deployer Address: ${poolDeployer}`);

        const factory = await quickSwapContract.factory();
        console.log(`Factory Address: ${factory}`);

        return { poolDeployer, factory };
    } catch (error) {
        console.error("Error fetching contract details:", error.message);
        return { poolDeployer: ethers.ZeroAddress, factory: ethers.ZeroAddress };
    }
}

// Check if a liquidity pool exists for the token pair
async function checkLiquidityPool(factoryAddress, tokenInAddress, tokenOutAddress) {
    try {
        const factoryContract = new ethers.Contract(factoryAddress, factoryAbi, provider);
        const poolAddress = await factoryContract.poolByPair(tokenInAddress, tokenOutAddress);
        console.log(`Liquidity Pool for ${tokenInAddress} - ${tokenOutAddress}: ${poolAddress}`);
        return poolAddress !== ethers.ZeroAddress;
    } catch (error) {
        console.error("Error checking liquidity pool:", error.message);
        return false;
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
        // Update tokenIn to WSTT for the swap
        tokenInKey = "WSTT";
    }

    console.log(`Swapping ${ethers.formatUnits(amountIn, tokenIn.decimals)} ${TOKENS[tokenInKey].symbol} to ${tokenOut.symbol}...`);

    // Approve token (WSTT in case of STT, or the token itself otherwise)
    await approveToken(tokenContracts[tokenInKey], TOKENS[tokenInKey].symbol, amountIn, TOKENS[tokenInKey].decimals);

    // Prepare swap parameters
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now
    const amountOutMinimum = 0; // Set to 0 for simplicity; in production, use a price oracle or slippage tolerance
    const limitSqrtPrice = 0; // No price limit for simplicity

    const wNativeToken = await quickSwapContract.WNativeToken();
    const params = {
        tokenIn: TOKENS[tokenInKey].address,
        tokenOut: tokenOut.isNative ? wNativeToken : tokenOut.address,
        deployer: poolDeployer, // Try poolDeployer first
        recipient: wallet.address,
        deadline: deadline,
        amountIn: amountIn,
        amountOutMinimum: amountOutMinimum,
        limitSqrtPrice: limitSqrtPrice
    };

    console.log("Swap Parameters:", params);

    // No value field since we're not sending native token directly
    const overrides = { gasLimit: 1000000 };

    // Perform the swap
    try {
        const swapTx = await quickSwapContract.exactInputSingle(params, overrides);
        console.log("Raw TX:", swapTx);
        const swapReceipt = await swapTx.wait();
        console.log(`Swapped ${TOKENS[tokenInKey].symbol} to ${tokenOut.symbol}: ${swapTx.hash}`);

        // If swapping to STT, unwrap WSTT to STT
        if (tokenOut.isNative) {
            const wsttBalance = await tokenContracts["WSTT"].balanceOf(wallet.address);
            if (wsttBalance > 0) {
                await unwrapWSTT(wsttBalance);
            }
        }
    } catch (error) {
        // Try again with deployer set to factory address if poolDeployer fails
        if (error.code === 'CALL_EXCEPTION' && params.deployer !== factory) {
            console.log("Swap failed with poolDeployer, retrying with factory address as deployer...");
            params.deployer = factory;
            console.log("Updated Swap Parameters:", params);
            const swapTx = await quickSwapContract.exactInputSingle(params, overrides);
            const swapReceipt = await swapTx.wait();
            console.log(`Swapped ${TOKENS[tokenInKey].symbol} to ${tokenOut.symbol}: ${swapTx.hash}`);

            if (tokenOut.isNative) {
                const wsttBalance = await tokenContracts["WSTT"].balanceOf(wallet.address);
                if (wsttBalance > 0) {
                    await unwrapWSTT(wsttBalance);
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

    const hasLiquidity = await checkLiquidityPool(factory, tokenInAddress, tokenOutAddress);
    if (!hasLiquidity) {
        throw new Error(`No liquidity pool exists for ${tokenInAddress}-${tokenOutAddress} (${tokenIn.symbol}-${tokenOut.symbol}) on QuickSwap. Please try a different token pair.`);
    }

    // Perform the swap
    try {
        await swapTokens(tokenInKey, tokenOutKey, amountToSwap, poolDeployer, factory);
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