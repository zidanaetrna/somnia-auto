require('dotenv').config();
const readline = require('readline');
const { performSwap } = require('./swap');
const { startBot } = require('./auto');

const PROJECT_NAME = process.env.PROJECT_NAME || "Somnia";
const CREATOR_NAME = process.env.CREATOR_NAME || "aetrna";

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
    console.log("");
    console.log(`================= Created by: ${CREATOR_NAME} ==========================`);
    console.log("");
}

async function getUserInput() {
    return new Promise((resolve) => {
        rl.question("Select an option (1-3): ", (option) => {
            const choice = parseInt(option);
            if (isNaN(choice) || choice < 1 || choice > 3) {
                console.error("Invalid option. Please select 1, 2, or 3.");
                process.exit(1);
            }

            if (choice === 1) {
                // Automatic swap only
                rl.question("Enter the amount of tokens to swap (e.g., 0.1): ", (amount) => {
                    rl.question("Enter the number of times to swap (e.g., 2): ", (count) => {
                        const amountToSwap = parseFloat(amount);
                        const swapCount = parseInt(count);
                        if (isNaN(amountToSwap) || amountToSwap <= 0) {
                            console.error("Invalid amount to swap. Must be a positive number.");
                            process.exit(1);
                        }
                        if (isNaN(swapCount) || swapCount <= 0) {
                            console.error("Invalid number of swaps. Must be a positive integer.");
                            process.exit(1);
                        }
                        resolve({ choice, amountToSwap, swapCount });
                    });
                });
            } else {
                // Automatic send or both
                rl.question("Enter the number of wallets to generate (e.g., 2): ", (num) => {
                    const numWallets = parseInt(num);
                    if (isNaN(numWallets) || numWallets <= 0) {
                        console.error("Invalid number of wallets. Must be a positive integer.");
                        process.exit(1);
                    }
                    if (choice === 2) {
                        resolve({ choice, numWallets });
                    } else {
                        rl.question("Enter the amount of tokens to swap (e.g., 0.1): ", (amount) => {
                            rl.question("Enter the number of times to swap (e.g., 2): ", (count) => {
                                const amountToSwap = parseFloat(amount);
                                const swapCount = parseInt(count);
                                if (isNaN(amountToSwap) || amountToSwap <= 0) {
                                    console.error("Invalid amount to swap. Must be a positive number.");
                                    process.exit(1);
                                }
                                if (isNaN(swapCount) || swapCount <= 0) {
                                    console.error("Invalid number of swaps. Must be a positive integer.");
                                    process.exit(1);
                                }
                                resolve({ choice, numWallets, amountToSwap, swapCount });
                            });
                        });
                    }
                });
            }
        });
    });
}

(async () => {
    displayInterface();
    const { choice, numWallets, amountToSwap, swapCount } = await getUserInput();

    if (choice === 1) {
        // Automatic swap only
        await performSwap(amountToSwap, swapCount);
        rl.close();
    } else if (choice === 2) {
        // Automatic send only
        console.log("Starting automatic send...");
        await startBot(numWallets, false);
    } else if (choice === 3) {
        // Both: Perform swaps first, then start automatic transactions
        await performSwap(amountToSwap, swapCount);
        console.log("\nStarting automatic send...");
        await startBot(numWallets, true); // Include token transfers
    }
})();