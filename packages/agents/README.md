# x402 EIP-7702 Agent Economy Demo

This guide walks you through running the full x402 Agent Economy cycle manually.

## Prerequisites

- **Bun** (or Node.js/pnpm)
- **Foundry** (for `anvil`)

## 1. Start Blockchain (Anvil)

Open a terminal and run a local Ethereum chain. We use port 8545.

```bash
anvil
```

Keep this terminal open.

## 2. Configuration & Keys

We use deterministic Anvil keys:

- **Deployer**: `0xac09...` (Account #0)
- **Relayer**: `0x59c6...` (Account #1)
- **Seller (Agent 1)**: `0x5de4...` (Account #2)
- **Buyer (Agent 2)**: `0x7c85...` (Account #3)

## 3. Deploy Contracts & Fund Accounts

We need to deploy the `Delegate` (logic) and `MockERC20` (token) contracts, then fund the Buyer with tokens and Relayer with ETH.

We have a setup script for this. Open a **new terminal**:

```bash
cd packages/agents
bun run src/setup-chain.ts
```

Output:

```bash
export DELEGATE_ADDRESS=0x5fbdb2315678afecb367f032d93f642f64180aa3
export TOKEN_ADDRESS=0xe7f1725e7734ce288f8367e1bb143e90bb3f0512

✅ Minted 1000 Tokens to Buyer
✅ Funded Relayer with 10 ETH
```

_(Note: If `src/setup-chain.ts` doesn't exist, you can create it or just run the demo orchestrator `bun run src/demo.ts` which does this automatically. For manual steps, I will provide the command to create this script below)._

## 4. Launch Facilitator Server

The Facilitator acts as the "Payment Oracle" and Relayer.

**Terminal 3**:

```bash
cd packages/server
# Set Environment Variables (Replace addresses with those output from Step 3 if different)
export PORT=3000
export RELAYER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export DELEGATE_ADDRESS=0x5fbdb2315678afecb367f032d93f642f64180aa3
export RPC_URL_31337=http://127.0.0.1:8545

bun run src/index.ts
```

## 5. Launch Agent 1 (Weather Seller)

This agent sells weather data for 1 Token.

**Terminal 4**:

```bash
cd packages/agents
export PORT=4000
export FACILITATOR_URL=http://localhost:3000
export SELLER_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
export TOKEN_ADDRESS=0xe7f1725e7734ce288f8367e1bb143e90bb3f0512
export ANVIL_RPC=http://127.0.0.1:8545

bun run src/weather-server.ts
```

## 6. Launch Agent 2 (Weather Buyer)

This agent autonomously buys weather data.

**Terminal 5**:

```bash
cd packages/agents
export PORT=4001
export WEATHER_AGENT_URL=http://localhost:4000/weather
export BUYER_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
export DELEGATE_ADDRESS=0x5fbdb2315678afecb367f032d93f642f64180aa3
export TOKEN_ADDRESS=0xe7f1725e7734ce288f8367e1bb143e90bb3f0512
export ANVIL_RPC=http://127.0.0.1:8545

bun run src/buyer-server.ts
```

## 7. Trigger Purchase

Agent 2 attempts to buy automatically on start. You can also trigger it manually:

```bash
curl http://localhost:4001/buy
```

## 8. Check Balances

Check Agent 1 (Seller) Balance:

```bash
curl http://localhost:4000/balance
```

Check Agent 2 (Buyer) Balance:

```bash
curl http://localhost:4001/balance
```

---

## One-Click Demo

If you prefer to run everything at once (useful for verifying the fix):

```bash
cd packages/agents
bun run src/demo.ts
```
