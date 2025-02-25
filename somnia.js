const Web3 = require('web3').default || require('web3');
const dotenv = require('dotenv');
dotenv.config();

// ----------------------------
// RPC & Chain Info (Somnia Devnet)
// ----------------------------
const RPC_SOMNIA = (process.env.RPC_SOMNIA || 'https://dream-rpc.somnia.network').trim();
const CHAIN_ID = Number(process.env.CHAIN_ID) || 50312;  // Somnia Devnet Chain ID

const web3 = new Web3(RPC_SOMNIA);

// ----------------------------
// Wallets (Private Keys from .env)
// ----------------------------
const privateKeyA = process.env.PRIVATE_KEY_A;
const privateKeyB = process.env.PRIVATE_KEY_B;

if (!privateKeyA || !privateKeyB) {
  throw new Error('Missing PRIVATE_KEY_A or PRIVATE_KEY_B in .env file');
}

const walletA = web3.eth.accounts.privateKeyToAccount(`0x${privateKeyA.trim()}`);
const walletB = web3.eth.accounts.privateKeyToAccount(`0x${privateKeyB.trim()}`);

const wallets = [walletA, walletB];

// ----------------------------
// Utility: EIP-1559 Fee Parameters
// ----------------------------
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

// ----------------------------
// Utility: Get Random Amount in Wei
// ----------------------------
// For example, random amount between 0.001 and 0.1 STT tokens
function getRandomAmount(min = 0.0001, max = 0.01) {
  const randomAmount = (Math.random() * (max - min) + min).toFixed(4);
  return web3.utils.toWei(randomAmount, 'ether');
}

// ----------------------------
// Function: Send STT Transaction
// ----------------------------
async function sendSttTx(fromWallet, toAddress) {
  try {
    const amountWei = getRandomAmount();
    const nonce = await web3.eth.getTransactionCount(fromWallet.address, 'latest');
    const feeParams = await getFeeParams();

    // Estimate gas limit for the transaction
    const gasLimit = await web3.eth.estimateGas({
      from: fromWallet.address,
      to: toAddress,
      value: amountWei,
    });

    const txObject = {
      from: fromWallet.address,
      to: toAddress,
      value: amountWei,
      gas: gasLimit,
      nonce: nonce,
      chainId: CHAIN_ID,
      type: '0x2',
      maxFeePerGas: feeParams.maxFeePerGas,
      maxPriorityFeePerGas: feeParams.maxPriorityFeePerGas,
    };

    const signedTx = await web3.eth.accounts.signTransaction(txObject, fromWallet.privateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    console.log(`Tx sent from ${fromWallet.address} to ${toAddress}`);
    console.log(`Amount: ${web3.utils.fromWei(amountWei, 'ether')} STT`);
    console.log(`Tx Hash: ${receipt.transactionHash}`);
  } catch (error) {
    console.error(`Error sending tx from ${fromWallet.address} to ${toAddress}:`, error);
  }
}

// ----------------------------
// Circular Transaction Loop using wallet A and wallet B
// ----------------------------
let currentIndex = 0;
async function processNextTx() {
  const fromWallet = wallets[currentIndex];
  const toWallet = wallets[(currentIndex + 1) % wallets.length];

  console.log(`\nProcessing tx: ${fromWallet.address} → ${toWallet.address}`);
  await sendSttTx(fromWallet, toWallet.address);

  // Toggle between wallet A and wallet B
  currentIndex = (currentIndex + 1) % wallets.length;
}

// ----------------------------
// Start the Bot: Execute a tx every 1 minutes
// ----------------------------
async function startBot() {
  // Execute the first tx immediately
  await processNextTx();

  // Schedule subsequent transactions every 1 minute
setInterval(async () => {
  await processNextTx();
}, 1 * 60 * 1000); // 1 minute in milliseconds

}

startBot();
