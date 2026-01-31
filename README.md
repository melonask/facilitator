# x402 Facilitator (EIP-7702)

A reference implementation of the [x402 Protocol](https://www.x402.org/) using EIP-7702 for gasless, authorized token transfers. Demonstrates a complete autonomous agent economy where AI agents discover, negotiate, and pay for resources on-chain without holding native gas tokens.

## Features

- **EIP-7702 delegation** — EOAs temporarily delegate code to a smart contract for sponsored "gasless" transactions
- **EIP-712 signatures** — typed structured data signing for payment intents
- **ERC-20 and native ETH** — supports both token and native currency transfers
- **Bazaar discovery** — automated indexing of payable resources (`/discovery/resources`)
- **Gas optimization** — detects existing account code to skip redundant authorization lists
- **Multi-chain** — dynamic chain configuration via `RPC_URL_<chainId>` environment variables
- **Agent economy** — includes demo Seller (Weather API) and Buyer (Consumer) agents

## Architecture

```
packages/
  contracts/   Delegate.sol — EIP-7702 delegation target (Foundry)
  server/      Payment facilitator — verifies + settles via relayer (Bun)
  agents/      Demo seller and buyer agents (Bun)
```

1. **Facilitator** (`packages/server`) — payment gateway that verifies signatures off-chain and settles transactions on-chain through a relayer
2. **Smart Contracts** (`packages/contracts`) — `Delegate.sol` handles signature verification and token/ETH transfers
3. **Agents** (`packages/agents`) — Seller protects resources behind a 402 paywall; Buyer autonomously handles 402 responses and executes payments

## Prerequisites

- [Bun](https://bun.sh/) v1.1+
- [Foundry](https://getfoundry.sh/) (`anvil`, `forge`)

## Quick Start

```sh
# Install all workspace dependencies
bun install

# Run the full demo (deploys contracts, starts all services, executes a purchase)
bun run demo
```

## Manual Setup

### 1. Start Local Blockchain

```sh
anvil --port 8545
```

### 2. Deploy Contracts

```sh
cd packages/agents
bun run setup
```

Copy the output `DELEGATE_ADDRESS` and `TOKEN_ADDRESS` for the next steps.

### 3. Start Facilitator

```sh
cd packages/server
export RELAYER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export DELEGATE_ADDRESS=<paste>
export RPC_URL_31337=http://127.0.0.1:8545
bun run start
```

### 4. Start Seller Agent

```sh
cd packages/agents
export PORT=4000
export FACILITATOR_URL=http://localhost:3000
export SELLER_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
export TOKEN_ADDRESS=<paste>
export ANVIL_RPC=http://127.0.0.1:8545
bun run src/weather-server.ts
```

### 5. Start Buyer Agent

```sh
cd packages/agents
export PORT=4001
export WEATHER_AGENT_URL=http://localhost:4000/weather
export BUYER_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
export DELEGATE_ADDRESS=<paste>
export TOKEN_ADDRESS=<paste>
export ANVIL_RPC=http://127.0.0.1:8545
bun run src/buyer-server.ts
```

## API Reference

### Facilitator (`packages/server`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/healthcheck` | Service status and uptime |
| `GET` | `/supported` | Supported schemes, networks, signer address |
| `GET` | `/discovery/resources` | Bazaar catalog of discoverable x402 resources |
| `POST` | `/verify` | Off-chain verification of a payment payload |
| `POST` | `/settle` | Verify and submit the transaction on-chain |

### Seller Agent (`packages/agents`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/weather` | Protected resource — returns 402 or 200 with data |
| `GET` | `/balance` | Debug endpoint for ETH and token balances |

## Testing

```sh
# Solidity tests (Foundry)
bun run test:contracts

# TypeScript tests (all workspace packages)
bun run test

# Type checking (all workspace packages)
bun run typecheck
```

## Adding New Chains

The facilitator is chain-agnostic. Add an RPC endpoint per chain via environment variables:

```sh
export RPC_URL_8453=https://mainnet.base.org   # Base
export RPC_URL_1=https://eth.llamarpc.com       # Ethereum
```

Format: `RPC_URL_<chainId>`

## License

MIT
