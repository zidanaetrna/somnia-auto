require('dotenv').config();
const ethers = require('ethers');

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.MAIN_PRIVATE_KEY, provider);

const SWAP_ADDRESS = process.env.SWAP_ADDRESS;
const PING_TOKEN = process.env.PING_TOKEN;
const PONG_TOKEN = process.env.PONG_TOKEN;
const FEE_TIER = parseInt(process.env.FEE_TIER) || 500;
const MIN_GAS_BALANCE = process.env.MIN_GAS_BALANCE || "0.01";
const TOKEN_A_SYMBOL = process.env.TOKEN_A_SYMBOL || "$PING";
const TOKEN_B_SYMBOL = process.env.TOKEN_B_SYMBOL || "$PONG";
const NATIVE_TOKEN_SYMBOL = process.env.NATIVE_TOKEN_SYMBOL || "STT";

// Validate required environment variables
if (!SWAP_ADDRESS || !PING_TOKEN || !PONG_TOKEN) {
    throw new Error("Missing required environment variables in .env file: SWAP_ADDRESS, PING_TOKEN, PONG_TOKEN");
}

const erc20Abi = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
    "function allowance(address owner, address spender) external view returns (uint256)"
];

const swapContractAbi = [
    {
        "inputs": [
            {
                "components": [
                    { "internalType": "address", "name": "tokenIn", "type": "address" },
                    { "internalType": "address", "name": "tokenOut", "type": "address" },
                    { "internalType": "uint24", "name": "fee", "type": "uint24" },
                    { "internalType": "address", "name": "recipient", "type": "address" },
                    { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
                    { "internalType": "uint256", "name": "amountOutMinimum", "type": "uint256" },
                    { "internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160" }
                ],
                "internalType": "struct ExactInputSingleParams",
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
    }
];

const pingContract = new ethers.Contract(PING_TOKEN, erc20Abi, wallet);
const pongContract = new ethers.Contract(PONG_TOKEN, erc20Abi, wallet);
const swapContract = new ethers.Contract(SWAP_ADDRESS, swapContractAbi, wallet);

async function approveToken(tokenContract, tokenName, amount) {
    const allowance = await tokenContract.allowance(wallet.address, SWAP_ADDRESS);
    if (allowance < amount) {
        console.log(`Approving ${tokenName}...`);
        const maxApproval = ethers.MaxUint256;
        const approveTx = await tokenContract.approve(SWAP_ADDRESS, maxApproval);
        await approveTx.wait();
        console.log(`Approved ${tokenName}: ${approveTx.hash}`);
    }
}

async function swapTokens(tokenInContract, tokenInName, tokenInAddress, tokenOutName, tokenOutAddress, amountIn, fee, amountOutMin, sqrtPriceLimitX96) {
    const balance = await tokenInContract.balanceOf(wallet.address);
    if (balance < amountIn) {
        throw new Error(`Insufficient ${tokenInName} balance`);
    }

    console.log(`Swapping ${tokenInName} to ${tokenOutName}...`);
    console.log(`Amount Out Min: ${ethers.formatUnits(amountOutMin, 18)}`);
    await approveToken(tokenInContract, tokenInName, amountIn);

    const params = {
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        fee: fee,
        recipient: wallet.address,
        amountIn: amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: sqrtPriceLimitX96
    };

    const swapTx = await swapContract.exactInputSingle(params, { gasLimit: 1000000 });
    console.log("Raw TX:", swapTx);
    const swapReceipt = await swapTx.wait();
    console.log(`Swapped ${tokenInName} to ${tokenOutName}: ${swapTx.hash}`);
}

async function performSwap(amountToSwap, swapCount) {
    const fee = FEE_TIER;
    const amountOutMin = 0;
    const sqrtPriceLimitX96 = 0n;

    console.log("Wallet Address:", wallet.address);
    const sttBalance = await provider.getBalance(wallet.address);
    const pingBalance = await pingContract.balanceOf(wallet.address);
    const pongBalance = await pongContract.balanceOf(wallet.address);
    const pingAllowance = await pingContract.allowance(wallet.address, SWAP_ADDRESS);
    console.log(`${TOKEN_A_SYMBOL} Balance: ${ethers.formatUnits(pingBalance, 18)}`);
    console.log(`${TOKEN_B_SYMBOL} Balance: ${ethers.formatUnits(pongBalance, 18)}`);
    console.log(`${TOKEN_A_SYMBOL} Allowance: ${ethers.formatUnits(pingAllowance, 18)}`);
    console.log(`${NATIVE_TOKEN_SYMBOL} Balance: ${ethers.formatUnits(sttBalance, 18)}`);

    if (sttBalance < ethers.parseUnits(MIN_GAS_BALANCE, 18)) {
        throw new Error(`Insufficient ${NATIVE_TOKEN_SYMBOL} balance for gas fees`);
    }

    const amountIn = ethers.parseUnits(amountToSwap.toString(), 18);

    for (let i = 0; i < swapCount; i++) {
        console.log(`\nSwap Sequence ${i + 1}/${swapCount}:`);
        try {
            await swapTokens(pingContract, TOKEN_A_SYMBOL, PING_TOKEN, TOKEN_B_SYMBOL, PONG_TOKEN, amountIn, fee, amountOutMin, sqrtPriceLimitX96);
            await swapTokens(pongContract, TOKEN_B_SYMBOL, PONG_TOKEN, TOKEN_A_SYMBOL, PING_TOKEN, amountIn, fee, amountOutMin, sqrtPriceLimitX96);
        } catch (error) {
            if (error.code === 'CALL_EXCEPTION') {
                console.error("Revert Reason:", error.reason || "Unknown (check contract or network)");
                console.error("Transaction:", error.transaction);
                console.error("Receipt:", error.receipt);
            } else {
                console.error("Unexpected Error:", error);
            }
            break;
        }
    }
}

module.exports = { performSwap };