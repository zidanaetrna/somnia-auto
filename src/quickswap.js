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
        if (poolAddress === ethers.ZeroAddress) {
            return null;
        }
        const poolContract = new ethers.Contract(poolAddress, poolAbi, provider);
        const liquidity = await poolContract.liquidity();
        const token0 = await poolContract.token0();
        const token1 = await poolContract.token1();
        const usdcBalance = await tokenContracts["USDC"].balanceOf(poolAddress);
        console.log(`Pool Liquidity: ${ethers.formatEther(liquidity)}`);
        console.log(`Pool Tokens: token0=${token0}, token1=${token1}`);
        console.log(`USDC Balance in Pool: ${ethers.formatUnits(usdcBalance, 6)} USDC`);
        return liquidity > 0 ? poolAddress : null;
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

async function unwrapWSTT(amount) {
    const wsttContract = tokenContracts["WSTT"];
    console.log(`Unwrapping ${ethers.formatUnits(amount, 18)} WSTT to STT...`);
    const withdrawTx = await wsttContract.withdraw(amount, { gasLimit: 100000 });
    await withdrawTx.wait();
    console.log(`Unwrapped WSTT to STT: ${withdrawTx.hash}`);
}

async function swapTokens(tokenInKey, tokenOutKey, amountIn, poolDeployer, factory) {
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

    const poolAddress = await checkLiquidityPool(factory, tokenInAddress, tokenOutAddress);
    if (!poolAddress) {
        throw new Error(`No viable liquidity pool for ${tokenIn.symbol} > ${tokenOut.symbol}`);
    }

    // Use the exact minimum received from the QuickSwap website for STT > USDC
    let amountOutMinimum;
    if (tokenInKey === "STT" && tokenOutKey === "USDC" && amountIn === "0.1") {
        amountOutMinimum = ethers.parseUnits("0.014482", tokenOut.decimals); // From website
        console.log(`Using website minimum received: ${ethers.formatUnits(amountOutMinimum, tokenOut.decimals)} ${tokenOut.symbol}`);
    } else {
        // Fallback to 0 for other swaps (can be improved later)
        amountOutMinimum = 0;
        console.log("No specific minimum set, using 0 (no slippage protection)");
    }

    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const params = {
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        deployer: poolDeployer,
        recipient: wallet.address,
        deadline: deadline,
        amountIn: amount,
        amountOutMinimum: amountOutMinimum,
        limitSqrtPrice: 0
    };

    console.log("Swap Parameters:", JSON.stringify(params, (key, value) => typeof value === 'bigint' ? value.toString() : value));

    const overrides = { gasLimit: 1000000 };

    // Simulate the transaction
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

    if (tokenOut.isNative) {
        const wsttBalance = await tokenContracts["WSTT"].balanceOf(wallet.address);
        if (wsttBalance > 0) {
            await unwrapWSTT(wsttBalance);
        }
    }
}

async function performQuickSwap(wallet, tokenInKey, tokenOutKey, amountIn, provider) {
    try {
        if (!wallet || !tokenInKey || !tokenOutKey || amountIn === undefined || !provider) {
            throw new Error(`Missing required parameters`);
        }

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

        const { poolDeployer, factory } = await logContractDetails();

        const tokenInAddress = tokenInInfo.isNative ? wNativeTokenAddress : tokenInInfo.address;
        const tokenOutAddress = tokenOutInfo.isNative ? wNativeTokenAddress : tokenOutInfo.address;

        console.log(`\nChecking liquidity for ${tokenInKey} > ${tokenOutKey}...`);
        const poolAddress = await checkLiquidityPool(factory, tokenInAddress, tokenOutAddress);
        if (!poolAddress) {
            throw new Error(`No viable liquidity pool for ${tokenInKey} > ${tokenOutKey}`);
        }
        console.log(`Liquidity pool found: ${poolAddress}`);

        await swapTokens(tokenInKey, tokenOutKey, ethers.formatUnits(amountIn, tokenInInfo.decimals), poolDeployer, factory);

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