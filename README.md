Here’s a detailed `README.md` file for your project. This file provides an overview of the project, setup instructions, usage examples, and other relevant information. It’s designed to help users (or yourself) understand and use the project effectively.

---

# Somnia Auto-Bot

The **Somnia Auto-Bot** is a Node.js-based automation tool designed to perform token swaps and automatic transactions on the Somnia network. It allows users to generate additional wallets, store their private keys securely, and perform circular transactions between the main wallet and generated wallets. The bot supports swapping tokens (`$PING` and `$PONG`) and sending native tokens (`STT`) automatically.

---

## Features

1. **Token Swapping**:
   - Swap `$PING` and `$PONG` tokens using a predefined swap contract.
   - Supports multiple swap sequences.

2. **Automatic Wallet Generation**:
   - Generate additional wallets based on user input.
   - Store wallet details (address and private key) securely in a `privatekey.json` file.

3. **Automatic Transactions**:
   - Send `STT` (native token) between wallets in a circular manner.
   - Optionally send `$PING` or `$PONG` tokens between wallets.

4. **User-Friendly Interface**:
   - ASCII art interface with menu options.
   - Interactive prompts for user input.

5. **Configuration via `.env`**:
   - Customize RPC URL, private keys, contract addresses, and other parameters.

---

## Prerequisites

Before using the Somnia Auto-Bot, ensure you have the following installed:

- **Node.js** (v16 or higher)
- **npm** (Node Package Manager)
- **Git** (optional, for cloning the repository)

---

## Installation

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/your-username/somnia-auto-bot.git
   cd somnia-auto-bot
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Set Up `.env` File**:
   Create a `.env` file in the root directory and add the following configuration:
   ```env
   # Network and Wallet Info
   RPC_URL=https://dream-rpc.somnia.network
   MAIN_PRIVATE_KEY=your_main_private_key_here
   CHAIN_ID=50312

   # Contract Addresses
   SWAP_ADDRESS=0x6aac14f090a35eea150705f72d90e4cdc4a49b2c
   PING_TOKEN=0x33e7fab0a8a5da1a923180989bd617c9c2d1c493
   PONG_TOKEN=0x9beaa0016c22b646ac311ab171270b0ecf23098f

   # Swap Parameters
   FEE_TIER=500
   MIN_GAS_BALANCE=0.01

   # Display Symbols
   NATIVE_TOKEN_SYMBOL=STT
   TOKEN_A_SYMBOL=$PING
   TOKEN_B_SYMBOL=$PONG
   PROJECT_NAME=Somnia
   CREATOR_NAME=aetrna
   ```

   Replace `your_main_private_key_here` with your main wallet's private key.

---

## Usage

### Running the Bot

1. **Start the Bot**:
   ```bash
   node main.js
   ```

2. **Choose an Option**:
   The bot will display a menu with the following options:
   ```
   [1] Automatic swap
   [2] Automatic send
   [3] Both
   ```

   - **Option 1**: Perform token swaps only.
   - **Option 2**: Generate wallets and perform automatic `STT` transactions.
   - **Option 3**: Perform both token swaps and automatic transactions.

3. **Follow the Prompts**:
   - For **Option 1**, enter the amount of tokens to swap and the number of swap sequences.
   - For **Option 2** or **Option 3**, enter the number of wallets to generate.

---

### Example Workflow

#### Option 1: Automatic Swap
```bash
Select an option (1-3): 1
Enter the amount of tokens to swap (e.g., 0.1): 0.1
Enter the number of times to swap (e.g., 2): 2
```

#### Option 2: Automatic Send
```bash
Select an option (1-3): 2
Enter the number of wallets to generate (e.g., 2): 2
```

#### Option 3: Both
```bash
Select an option (1-3): 3
Enter the number of wallets to generate (e.g., 2): 2
Enter the amount of tokens to swap (e.g., 0.1): 0.1
Enter the number of times to swap (e.g., 2): 2
```

---

## Project Structure

- **`swap.js`**: Handles token swap logic.
- **`auto.js`**: Manages wallet generation, storage, and automatic transactions.
- **`main.js`**: Provides the user interface and orchestrates the bot.
- **`.env`**: Stores configuration variables.
- **`privatekey.json`**: Stores generated wallet details.

---

## Notes

1. **Wallet Funding**:
   - Generated wallets start with zero balance. Ensure the main wallet funds them with `STT` for gas fees and `$PING`/`$PONG` tokens for transfers.

2. **Security**:
   - Never share your `.env` file or `privatekey.json` file. These contain sensitive information.

3. **Transaction Fees**:
   - Ensure the main wallet has sufficient `STT` for gas fees.

4. **Customization**:
   - Modify the `.env` file to use different RPC URLs, contract addresses, or tokens.

---

## Dependencies

- **`ethers`**: For interacting with the Ethereum blockchain.
- **`web3`**: For additional blockchain functionality.
- **`dotenv`**: For loading environment variables from `.env`.

Install dependencies using:
```bash
npm install ethers web3 dotenv
```

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## Support

For questions or issues, please open an issue on the [GitHub repository](https://github.com/your-username/somnia-auto-bot).

---

Enjoy using the Somnia Auto-Bot! 🚀

---

This `README.md` provides a comprehensive guide for setting up and using your project. Let me know if you need further assistance!