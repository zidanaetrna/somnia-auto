require('dotenv').config();
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

// Debug: Log the MAIN_PRIVATE_KEY to confirm it’s loaded correctly
console.log('Loaded MAIN_PRIVATE_KEY:', MAIN_PRIVATE_KEY);
console.log('MAIN_PRIVATE_KEY length:', MAIN_PRIVATE_KEY.length);

if (!RPC_URL || !MAIN_PRIVATE_KEY || !PING_TOKEN || !PONG_TOKEN) {
    throw new Error('Missing required environment variables in .env file: RPC_URL, MAIN_PRIVATE_KEY, PING_TOKEN, PONG_TOKEN');
}

const provider = new ethers.JsonRpcProvider(RPC_URL);

// Debug: Validate the MAIN_PRIVATE_KEY with ethers
let mainWallet;
try {
    mainWallet = new ethers.Wallet(MAIN_PRIVATE_KEY, provider);
    console.log('Main wallet address (from ethers):', mainWallet.address);
} catch (error) {
    console.error('Error validating MAIN_PRIVATE_KEY with ethers:', error.message);
    process.exit(1);
}

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
        const privateKey = wallet.privateKey.replace('0x', '');
        console.log(`Generated wallet ${i + 1} private key:`, privateKey);
        console.log(`Generated wallet ${i + 1} private key length:`, privateKey.length);
        newWallets.push({
            address: wallet.address,
            privateKey: privateKey
        });
    }

    // Combine main wallet and generated wallets
    console.log('Main wallet private key:', MAIN_PRIVATE_KEY);
    console.log('Main wallet private key length:', MAIN_PRIVATE_KEY.length);
    wallets = [
        { address: mainWallet.address, privateKey: MAIN_PRIVATE_KEY },
        ...newWallets
    ];

    // Log the entire wallets array
    console.log('Wallets array before saving:', JSON.stringify(wallets, null, 2));

    // Save to privatekey.json
    fs.writeFileSync('privatekey.json', JSON.stringify(wallets, null, 2));
    console.log(`Generated ${numWallets} new wallets and saved to privatekey.json`);
}

// Initialize wallet instances (using ethers)
function initializeWallets() {
    console.log('Starting initializeWallets...');
    console.log('Wallets array:', JSON.stringify(wallets, null, 2));
    return wallets.map((wallet, index) => {
        console.log(`Processing wallet ${index + 1} private key:`, wallet.privateKey);
        console.log(`Processing wallet ${index + 1} private key length:`, wallet.privateKey.length);
        return new ethers.Wallet(wallet.privateKey, provider);
    });
}

// Utility: Fetch Fee Parameters with Fallback to Legacy Gas Pricing
async function getFeeParams() {
    try {
        const feeData = await provider.getFeeData();
        console.log('Fetched fee data:', feeData);

        // Check if EIP-1559 fee data is available
        if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
            console.log('Using EIP-1559 fee data');
            return {
                type: 2, // EIP-1559 transaction
                maxFeePerGas: feeData.maxFeePerGas,
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
            };
        } else {
            console.log('EIP-1559 fee data not available, estimating legacy gas price');
            // Estimate gas price by fetching recent blocks (ethers@6.x workaround)
            const block = await provider.getBlock('latest');
            const baseFeePerGas = block.baseFeePerGas || ethers.parseUnits('1', 'gwei'); // Fallback to 1 gwei if baseFeePerGas is unavailable
            const gasPrice = baseFeePerGas + ethers.parseUnits('1', 'gwei'); // Add a small buffer
            console.log('Estimated gas price:', ethers.formatUnits(gasPrice, 'gwei'), 'gwei');
            return {
                type: 0, // Legacy transaction
                gasPrice: gasPrice,
            };
        }
    } catch (error) {
        console.error('Error fetching fee data:', error.message);
        console.log('Falling back to default legacy gas price');
        // Fallback to a default gas price (e.g., 5 gwei) if the RPC fails
        return {
            type: 0,
            gasPrice: ethers.parseUnits('5', 'gwei'),
        };
    }
}

// Utility: Get Random Amount in Ether
function getRandomAmount(min = 0.0001, max = 0.01) {
    const randomAmount = (Math.random() * (max - min) + min).toFixed(4);
    return ethers.parseEther(randomAmount.toString());
}

// Function: Send STT Transaction (using ethers)
async function sendSttTx(fromWallet, toAddress) {
    try {
        // Check balance before sending
        const balance = await provider.getBalance(fromWallet.address);
        console.log(`Balance of ${fromWallet.address}: ${ethers.formatEther(balance)} ${NATIVE_TOKEN_SYMBOL}`);

        const amount = getRandomAmount();
        console.log(`Transaction amount: ${ethers.formatEther(amount)} ${NATIVE_TOKEN_SYMBOL}`);

        const nonce = await provider.getTransactionCount(fromWallet.address, 'pending');
        console.log(`Nonce for ${fromWallet.address}: ${nonce}`);

        const feeParams = await getFeeParams();

        const tx = {
            to: toAddress,
            value: amount,
            nonce: nonce,
            chainId: CHAIN_ID,
            ...feeParams, // Spread the fee parameters (type, maxFeePerGas/maxPriorityFeePerGas or gasPrice)
        };

        // Estimate gas
        const gasLimit = await fromWallet.estimateGas(tx);
        console.log(`Estimated gas limit: ${gasLimit}`);
        tx.gasLimit = gasLimit;

        // Estimate total cost
        const gasCost = tx.type === 0 ? gasLimit * tx.gasPrice : gasLimit * tx.maxFeePerGas;
        const totalCost = amount + gasCost;
        console.log(`Estimated gas cost: ${ethers.formatEther(gasCost)} ${NATIVE_TOKEN_SYMBOL}`);
        console.log(`Total cost (amount + gas): ${ethers.formatEther(totalCost)} ${NATIVE_TOKEN_SYMBOL}`);

        // Check if the wallet has enough balance
        if (balance < totalCost) {
            throw new Error(`Insufficient balance: ${ethers.formatEther(balance)} ${NATIVE_TOKEN_SYMBOL}, required: ${ethers.formatEther(totalCost)} ${NATIVE_TOKEN_SYMBOL}`);
        }

        // Sign and send the transaction
        const signedTx = await fromWallet.signTransaction(tx);
        console.log('Signed transaction:', signedTx);

        const txResponse = await provider.broadcastTransaction(signedTx);
        const receipt = await txResponse.wait();

        console.log(`Tx sent from ${fromWallet.address} to ${toAddress}`);
        console.log(`Amount: ${ethers.formatEther(amount)} ${NATIVE_TOKEN_SYMBOL}`);
        console.log(`Tx Hash: ${receipt.hash}`);
    } catch (error) {
        console.error(`Error sending ${NATIVE_TOKEN_SYMBOL} tx from ${fromWallet.address} to ${toAddress}:`, error);
    }
}

// Function: Send ERC-20 Token Transaction ($PING or $PONG)
async function sendTokenTx(fromWallet, toAddress, tokenContract, tokenSymbol) {
    try {
        const amount = getRandomAmount(0.1, 1.0); // Random amount between 0.1 and 1 token
        const balance = await tokenContract.balanceOf(fromWallet.address);
        if (balance < amount) {
            console.log(`Insufficient ${tokenSymbol} balance for ${fromWallet.address}`);
            return;
        }

        const tx = await tokenContract.transfer(toAddress, amount, { gasLimit: 100000 });
        const receipt = await tx.wait();
        console.log(`Token tx sent from ${fromWallet.address} to ${toAddress}`);
        console.log(`Amount: ${ethers.formatUnits(amount, 18)} ${tokenSymbol}`);
        console.log(`Tx Hash: ${receipt.hash}`);
    } catch (error) {
        console.error(`Error sending ${tokenSymbol} tx from ${fromWallet.address} to ${toAddress}:`, error);
    }
}

// Circular Transaction Loop
let currentIndex = 0;
async function processNextTx(walletInstances, sendTokens = false) {
    const fromWallet = walletInstances[currentIndex];
    const toWallet = walletInstances[(currentIndex + 1) % walletInstances.length];

    console.log(`\nProcessing tx: ${fromWallet.address} → ${toWallet.address}`);

    // Send STT first (for gas fees)
    await sendSttTx(fromWallet, toWallet.address);

    // Send tokens ($PING or $PONG) if enabled
    if (sendTokens) {
        const tokenToSend = Math.random() < 0.5 ? "PING" : "PONG";
        const tokenContract = tokenToSend === "PING"
            ? new ethers.Contract(PING_TOKEN, erc20Abi, fromWallet)
            : new ethers.Contract(PONG_TOKEN, erc20Abi, fromWallet);
        const tokenSymbol = tokenToSend === "PING" ? TOKEN_A_SYMBOL : TOKEN_B_SYMBOL;
        await sendTokenTx(fromWallet, toWallet.address, tokenContract, tokenSymbol);
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
