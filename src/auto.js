require('dotenv').config();
const Web3 = require('web3');
const ethers = require('ethers');
const fs = require('fs');

const RPC_URL = process.env.RPC_URL;
const CHAIN_ID = Number(process.env.CHAIN_ID) || 50312;
const MAIN_PRIVATE_KEY = process.env.MAIN_PRIVATE_KEY;
const PING_TOKEN = process.env.PING_TOKEN;
const PONG_TOKEN = process.env.PONG_TOKEN;
const NATIVE_TOKEN_SYMBOL = process.env.NATIVE_TOKEN_SYMBOL || "STT";
const TOKEN_A_SYMBOL = process.env.TOKEN_A_SYMBOL || "$PING";
const TOKEN_B_SYMBOL = process.env.TOKEN_B_SYMBOL || "$PONG";

if (!RPC_URL || !MAIN_PRIVATE_KEY || !PING_TOKEN || !PONG_TOKEN) {
    throw new Error('Missing required environment variables in .env file: RPC_URL, MAIN_PRIVATE_KEY, PING_TOKEN, PONG_TOKEN');
}

const web3 = new Web3(RPC_URL);
const provider = new ethers.JsonRpcProvider(RPC_URL);
const mainWallet = new ethers.Wallet(MAIN_PRIVATE_KEY, provider);

// Load or initialize privatekey.json
let wallets = [];
if (fs.existsSync('privatekey.json')) {
    wallets = JSON.parse(fs.readFileSync('privatekey.json', 'utf8'));
}

const erc20Abi = [
    "function balanceOf(address account) external view returns (uint256)",
    "function transfer(address recipient, uint256 amount) external returns (bool)"
];

// Function to generate new wallets and store them in privatekey.json
async function generateWallets(numWallets) {
    const newWallets = [];
    for (let i = 0; i < numWallets; i++) {
        const wallet = ethers.Wallet.createRandom();
        newWallets.push({
            address: wallet.address,
            privateKey: wallet.privateKey
        });
    }

    // Combine main wallet and generated wallets
    wallets = [
        { address: mainWallet.address, privateKey: MAIN_PRIVATE_KEY },
        ...newWallets
    ];

    // Save to privatekey.json
    fs.writeFileSync('privatekey.json', JSON.stringify(wallets, null, 2));
    console.log(`Generated ${numWallets} new wallets and saved to privatekey.json`);
}

// Initialize wallet instances
function initializeWallets() {
    return wallets.map(wallet => ({
        eth: web3.eth.accounts.privateKeyToAccount(wallet.privateKey),
        ethers: new ethers.Wallet(wallet.privateKey, provider)
    }));
}

// Utility: EIP-1559 Fee Parameters
async function getFeeParams() {
    const latestBlock = await web3.eth.getBlock('latest');
    if (!latestBlock.baseFeePerGas) {
        throw new Error('Latest block does not include baseFeePerGas.');
    }
    const baseFeePerGas = BigInt(latestBlock.baseFeePerGas);
    const maxPriorityFeePerGas = BigInt(web3.utils.toWei('5', 'gwei'));
    const buffer = BigInt(web3.utils.toWei('2', 'gwei'));
    const maxFeePerGas = baseFeePerGas + maxPriorityFeePerGas + buffer;
    return {
        maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    };
}

// Utility: Get Random Amount in Wei
function getRandomAmount(min = 0.0001, max = 0.01) {
    const randomAmount = (Math.random() * (max - min) + min).toFixed(4);
    return web3.utils.toWei(randomAmount, 'ether');
}

// Function: Send STT Transaction
async function sendSttTx(fromWallet, toAddress) {
    try {
        const amountWei = getRandomAmount();
        const nonce = await web3.eth.getTransactionCount(fromWallet.eth.address, 'latest');
        const feeParams = await getFeeParams();

        const gasLimit = await web3.eth.estimateGas({
            from: fromWallet.eth.address,
            to: toAddress,
            value: amountWei,
        });

        const txObject = {
            from: fromWallet.eth.address,
            to: toAddress,
            value: amountWei,
            gas: gasLimit,
            nonce: nonce,
            chainId: CHAIN_ID,
            type: '0x2',
            maxFeePerGas: feeParams.maxFeePerGas,
            maxPriorityFeePerGas: feeParams.maxPriorityFeePerGas,
        };

        const signedTx = await web3.eth.accounts.signTransaction(txObject, fromWallet.eth.privateKey);
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        console.log(`Tx sent from ${fromWallet.eth.address} to ${toAddress}`);
        console.log(`Amount: ${web3.utils.fromWei(amountWei, 'ether')} ${NATIVE_TOKEN_SYMBOL}`);
        console.log(`Tx Hash: ${receipt.transactionHash}`);
    } catch (error) {
        console.error(`Error sending ${NATIVE_TOKEN_SYMBOL} tx from ${fromWallet.eth.address} to ${toAddress}:`, error);
    }
}

// Function: Send ERC-20 Token Transaction ($PING or $PONG)
async function sendTokenTx(fromWallet, toAddress, tokenContract, tokenSymbol) {
    try {
        const amountWei = getRandomAmount(0.1, 1.0); // Random amount between 0.1 and 1 token
        const balance = await tokenContract.balanceOf(fromWallet.ethers.address);
        if (balance < amountWei) {
            console.log(`Insufficient ${tokenSymbol} balance for ${fromWallet.ethers.address}`);
            return;
        }

        const tx = await tokenContract.transfer(toAddress, amountWei, { gasLimit: 100000 });
        const receipt = await tx.wait();
        console.log(`Token tx sent from ${fromWallet.ethers.address} to ${toAddress}`);
        console.log(`Amount: ${ethers.formatUnits(amountWei, 18)} ${tokenSymbol}`);
        console.log(`Tx Hash: ${receipt.transactionHash}`);
    } catch (error) {
        console.error(`Error sending ${tokenSymbol} tx from ${fromWallet.ethers.address} to ${toAddress}:`, error);
    }
}

// Circular Transaction Loop
let currentIndex = 0;
async function processNextTx(walletInstances, sendTokens = false) {
    const fromWallet = walletInstances[currentIndex];
    const toWallet = walletInstances[(currentIndex + 1) % walletInstances.length];

    console.log(`\nProcessing tx: ${fromWallet.eth.address} → ${toWallet.eth.address}`);

    // Send STT first (for gas fees)
    await sendSttTx(fromWallet, toWallet.eth.address);

    // Send tokens ($PING or $PONG) if enabled
    if (sendTokens) {
        const tokenToSend = Math.random() < 0.5 ? "PING" : "PONG";
        const tokenContract = tokenToSend === "PING"
            ? new ethers.Contract(PING_TOKEN, erc20Abi, fromWallet.ethers)
            : new ethers.Contract(PONG_TOKEN, erc20Abi, fromWallet.ethers);
        const tokenSymbol = tokenToSend === "PING" ? TOKEN_A_SYMBOL : TOKEN_B_SYMBOL;
        await sendTokenTx(fromWallet, toWallet.ethers.address, tokenContract, tokenSymbol);
    }

    currentIndex = (currentIndex + 1) % walletInstances.length;
}

// Start the Bot
async function startBot(numWallets, sendTokens = false) {
    await generateWallets(numWallets);
    const walletInstances = initializeWallets();
    await processNextTx(walletInstances, sendTokens);
    setInterval(async () => {
        await processNextTx(walletInstances, sendTokens);
    }, 1 * 60 * 1000); // 1 minute
}

module.exports = { startBot };