require('dotenv').config();
const readline = require('readline');
const ethers = require('ethers');
const { performQuickSwap } = require('./quickswap');

const PROJECT_NAME = process.env.PROJECT_NAME || "Somnia";
const CREATOR_NAME = process.env.CREATOR_NAME || "aetrna";

// Initialize provider and wallet
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.MAIN_PRIVATE_KEY, provider);

const TOKENS = {
    STT: { address: null, symbol: "STT", decimals: 18, isNative: true },
    WSTT: { address: "0x4A3BC48C156384f9564Fd65A53a2f3D534D8f2b7", symbol: "WSTT", decimals: 18, isNative: false },
    USDC: { address: "0xE9CC37904875B459Fa5D0FE37680d36F1ED55e38", symbol: "USDC", decimals: 6, isNative: false },
    WETH: { address: "0xd2480162Aa7F02Ead7BF4C127465446150D58452", symbol: "WETH", decimals: 18, isNative: false }
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function displayInterface() {
    console.log(`================ ${PROJECT_NAME} Auto-bot ==========================`);
    console.log("");
    console.log("..%%%%...%%%%%%..%%%%%%..%%%%%...%%..%%...%%%%..");
    console.log(".%%..%%..%%........%%....%%..%%..%%%.%%..%%..%%.");
    console.log(".%%%%%%..%%%%......%%....%%%%%...%%.%%%..%%%%%%.");
    console.log(".%%..%%..%%........%%....%%..%%..%%..%%..%%..%%.");
    console.log(".%%..%%..%%%%%%....%%....%%..%%..%%..%%..%%..%%.");
    console.log("................................................");
    console.log("");
    console.log("choose what you want to do:");
    console.log("");
    console.log("[1]  Automatic swap");
    console.log("[2]  Automatic send");
    console.log("[3]  Both");
    console.log("[4]  Swap via QuickSwap");
    console.log("");
    console.log(`================= Created by: ${CREATOR_NAME} ==========================`);
    console.log("");
}

async function getUserInput() {
    return new Promise((resolve) => {
        rl.question("Select an option (1-4): ", (option) => {
            const choice = parseInt(option);
            if (isNaN(choice) || choice < 1 || choice > 4) {
                console.error("Invalid option. Please select 1, 2, 3, or 4.");
                process.exit(1);
            }

            if (choice === 4) {
                console.log("\nAvailable tokens: STT, WSTT, USDC, WETH");
                console.log("Supported swaps: STT > [USDC, WETH, WSTT], WSTT > [USDC, WETH, STT], USDC > [STT, WSTT, WETH], WETH > [STT, USDC, WSTT]");
                rl.question("Enter the token to swap from (e.g., STT): ", (tokenIn) => {
                    const tokenInKey = tokenIn.toUpperCase();
                    if (!TOKENS[tokenInKey]) {
                        console.error("Invalid token. Must be one of: STT, WSTT, USDC, WETH");
                        process.exit(1);
                    }
                    rl.question("Enter the token to swap to (e.g., USDC): ", (tokenOut) => {
                        const tokenOutKey = tokenOut.toUpperCase();
                        if (!TOKENS[tokenOutKey]) {
                            console.error("Invalid token. Must be one of: STT, WSTT, USDC, WETH");
                            process.exit(1);
                        }
                        if (tokenInKey === tokenOutKey) {
                            console.error("Cannot swap a token for itself.");
                            process.exit(1);
                        }
                        rl.question("Enter the amount of tokens to swap (e.g., 0.1): ", (amount) => {
                            const amountToSwap = parseFloat(amount);
                            if (isNaN(amountToSwap) || amountToSwap <= 0) {
                                console.error("Invalid amount. Must be a positive number.");
                                process.exit(1);
                            }
                            rl.question("How many times do you want to swap? (e.g., 2, or 'n' for once): ", (count) => {
                                const swapCount = count.toLowerCase() === 'n' || count.toLowerCase() === 'no' ? 1 : parseInt(count);
                                if (isNaN(swapCount) || swapCount < 1) {
                                    console.error("Invalid swap count. Must be a positive integer or 'n'.");
                                    process.exit(1);
                                }
                                resolve({ choice, tokenInKey, tokenOutKey, amountToSwap, swapCount });
                            });
                        });
                    });
                });
            } else {
                console.error("Only option 4 is currently implemented.");
                process.exit(1);
            }
        });
    });
}

(async () => {
    displayInterface();
    const { choice, tokenInKey, tokenOutKey, amountToSwap, swapCount } = await getUserInput();

    if (choice === 4) {
        console.log(`\nPerforming QuickSwap: ${tokenInKey} to ${tokenOutKey} (${swapCount} time${swapCount > 1 ? 's' : ''})`);
        const amountIn = ethers.parseUnits(amountToSwap.toString(), TOKENS[tokenInKey].decimals);

        for (let i = 0; i < swapCount; i++) {
            console.log(`\nSwap ${i + 1}/${swapCount}:`);
            if (i % 2 === 0) {
                // Forward swap (e.g., STT > USDC)
                await performQuickSwap(wallet, tokenInKey, tokenOutKey, amountIn, provider);
            } else {
                // Reverse swap (e.g., USDC > STT)
                const reverseAmountIn = ethers.parseUnits(amountToSwap.toString(), TOKENS[tokenOutKey].decimals); // Approximate reverse amount
                await performQuickSwap(wallet, tokenOutKey, tokenInKey, reverseAmountIn, provider);
            }
        }
    }

    rl.close();
})();