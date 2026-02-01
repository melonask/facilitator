# @facilitator/agents

Demo agents for the x402 EIP-7702 payment facilitator. Includes a **seller** (weather data API behind a 402 paywall) and a **buyer** (autonomous consumer that handles 402 responses and pays on-chain).

```
  Agent Economy Flow

  ┌──────────────┐    GET /weather     ┌──────────────┐
  │ Buyer Agent  │────────────────────>│ Seller Agent │
  │ (port 4001)  │<── 402 + payment ──│ (port 4000)  │
  │              │    requirements     │              │
  │              │                     │              │
  │  1. Parse 402 requirements         │              │
  │  2. Sign EIP-712 PaymentIntent     │              │
  │  3. Sign EIP-7702 Authorization    │              │
  │              │                     │              │
  │              │── GET /weather ────>│              │
  │              │   + PAYMENT-SIG     │  4. POST /verify ──> Facilitator
  │              │                     │  5. POST /settle ──> (port 3000)
  │              │                     │  6. Wait for tx      │
  │              │<── 200 + data ──────│  7. Deliver data     │
  └──────────────┘                     └──────────────┘
```

## Agents

| Agent | Port | Role | Source |
|---|---|---|---|
| Weather Seller | `4000` | Sells weather data for 1 token per request | [`src/weather-server.ts`](src/weather-server.ts) |
| Weather Buyer | `4001` | Autonomously purchases weather data | [`src/buyer-server.ts`](src/buyer-server.ts) |
| Consumer Client | — | Standalone script, single purchase | [`src/consumer-client.ts`](src/consumer-client.ts) |

## Quick Start (One Command)

```sh
# From monorepo root — deploys contracts, starts everything, executes a purchase
bun run demo
```

## Manual Setup

### 1. Start Blockchain

```sh
anvil --port 8545
```

### 2. Deploy Contracts & Fund Accounts

```sh
bun run setup
```

Output:
```
export DELEGATE_ADDRESS=0x5fbdb2315678afecb367f032d93f642f64180aa3
export TOKEN_ADDRESS=0xe7f1725e7734ce288f8367e1bb143e90bb3f0512

Minted 1000 Tokens to Buyer
Funded Relayer with 10 ETH
```

### 3. Start Facilitator Server

```sh
cd ../server
export RELAYER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export DELEGATE_ADDRESS=<from step 2>
export RPC_URL_31337=http://127.0.0.1:8545
bun run start
```

### 4. Start Seller Agent

```sh
export PORT=4000
export FACILITATOR_URL=http://localhost:3000
export SELLER_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
export TOKEN_ADDRESS=<from step 2>
export ANVIL_RPC=http://127.0.0.1:8545
bun run src/weather-server.ts
```

### 5. Start Buyer Agent

```sh
export PORT=4001
export WEATHER_AGENT_URL=http://localhost:4000/weather
export BUYER_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
export DELEGATE_ADDRESS=<from step 2>
export TOKEN_ADDRESS=<from step 2>
export ANVIL_RPC=http://127.0.0.1:8545
bun run src/buyer-server.ts
```

The buyer auto-triggers a purchase 3 seconds after start. You can also trigger manually:

```sh
curl http://localhost:4001/buy
```

### 6. Check Balances

```sh
curl http://localhost:4000/balance   # Seller
curl http://localhost:4001/balance   # Buyer
```

## Deterministic Anvil Accounts

| Role | Account | Private Key |
|---|---|---|
| Deployer | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec...` (Account #0) |
| Relayer | `0x70997970C51812e339D9B73B0245ad59c36d573d` | `0x59c6995e9...` (Account #1) |
| Seller | `0x3C44CdDdB6a900c6639897b27E47a803D7c0F902` | `0x5de4111af...` (Account #2) |
| Buyer | `0x8626f6940E2eb28930DF3c1F24995d5B674d67eB` | `0x7c8521182...` (Account #3) |

## Environment Variables

### Seller

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: `4000`) |
| `FACILITATOR_URL` | Yes | Facilitator base URL |
| `SELLER_KEY` | Yes | Seller's private key |
| `TOKEN_ADDRESS` | Yes | ERC-20 token contract address |
| `ANVIL_RPC` | No | RPC URL (default: `http://127.0.0.1:8545`) |

### Buyer

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: `4001`) |
| `WEATHER_AGENT_URL` | Yes | Seller's weather endpoint URL |
| `BUYER_KEY` | Yes | Buyer's private key |
| `DELEGATE_ADDRESS` | Yes | Deployed `Delegate` contract address |
| `TOKEN_ADDRESS` | Yes | ERC-20 token contract address |
| `ANVIL_RPC` | No | RPC URL (default: `http://127.0.0.1:8545`) |

## Source Structure

```
src/
├── weather-server.ts   Seller agent — 402 paywall + weather data
├── buyer-server.ts     Buyer agent — autonomous consumer with HTTP API
├── consumer-client.ts  Standalone buyer script (no server)
├── demo.ts             Full orchestrator — starts everything
└── setup-chain.ts      Deploy contracts + fund accounts

test/
├── full-flow.test.ts   End-to-end agent economy test
├── Delegate.json       Compiled contract artifact
└── MockERC20.json      Compiled token artifact

public/
├── index.html          Web UI for the demo
├── script.js           Frontend logic
└── style.css           Styles
```

## Testing

```sh
bun test
```

The test starts Anvil, deploys contracts, launches the facilitator and seller, then runs the consumer client to verify the full purchase flow including on-chain balance assertions.

## License

MIT
