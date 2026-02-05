# x402 Facilitator

<img src="https://raw.githubusercontent.com/melonask/facilitator/refs/heads/main/packages/dash/public/scr.png" alt="x402 EIP-7702 Facilitator Dashboard">

Self-hosted payment facilitator for the [x402](https://github.com/coinbase/x402) protocol. Supports **EIP-7702** (any ERC-20, native ETH) and **ERC-3009** (USDC) payment mechanisms. Enables gasless transfers on any EVM chain.

## How It Works

The facilitator acts as a trusted relayer between a buyer and seller. The buyer never needs ETH for gas — the relayer pays gas and submits a Type 4 (EIP-7702) transaction that delegates the buyer's EOA to a `Delegate` contract, which then executes a signed token transfer.

```
  BUYER                     SELLER                   FACILITATOR
    |                         |                          |
    |--- GET /resource ------>|                          |
    |<-- 402 + requirements --|                          |
    |                         |                          |
    |  [sign EIP-712 intent]  |                          |
    |  [sign EIP-7702 auth]   |                          |
    |                         |                          |
    |--- GET + PAYMENT ------>|                          |
    |                         |--- POST /verify -------->|
    |                         |<-- { isValid: true } ----|
    |                         |--- POST /settle -------->|
    |                         |                     [submit Type 4 tx]
    |                         |                     [relayer pays gas]
    |                         |<-- { tx: 0x... } --------|
    |<-- 200 + data ----------|                          |
```

## Packages

| Package                                    | Description                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| [`packages/contracts`](packages/contracts) | Solidity `Delegate.sol` — EIP-7702 delegate for gasless payment intents  |
| [`packages/eip7702`](packages/eip7702)     | EIP-7702 mechanism library — verify + settle any ERC-20 via `viem`       |
| [`packages/server`](packages/server)       | Unified CLI server — supports EIP-7702 + ERC-3009 mechanisms             |
| [`packages/dash`](packages/dash)           | Real-time dashboard for monitoring facilitator balances and transactions |
| [`packages/demo`](packages/demo)           | Interactive demo with dual-token (USDT + USDC) buyer/seller agents       |

## Quick Start

<img src="https://raw.githubusercontent.com/melonask/facilitator/refs/heads/main/packages/demo/public/demo.gif" alt="x402 EIP-7702 demo — autonomous agent-to-agent payment">

### Try the Demo

<details>
  <summary>Requires: Foundry (for Anvil)</summary>

```bash
curl -L https://foundry.paradigm.xyz | bash
```

</details>

```bash
npx @facilitator/demo
```

> **Note:** You can also use `bunx`, `yarn dlx`, or `pnpm dlx` if you prefer.

Then in a new terminal, run the facilitator command printed by the demo:

```bash
npx @facilitator/server \
    --relayer-key 0x... \
    --delegate-address 0x... \
    --rpc-url http://127.0.0.1:8545
```

Open `http://localhost:3030` and click **INITIATE**.

### Facilitator Dashboard

```bash
npx @facilitator/dash
```

### Deploy Your Own

1. **Deploy the Delegate contract** (same address on every chain via CREATE2):

```bash
forge install melonask/facilitator
forge \
    script lib/facilitator/packages/contracts/script/Deploy.s.sol \
    --rpc-url <RPC_URL> \
    --broadcast
```

2. **Run the facilitator**:

**Multi-Chain:**

```bash
npx @facilitator/server \
  --relayer-key 0x... \
  --chain 1=https://,https:// \
  --chain 137=https://polygon-rpc.com
```

**Single-Chain:**

```bash
npx @facilitator/server \
  --relayer-key 0x... \
  --rpc-url https://...
```

The server automatically resolves the `Delegate.sol` address for known networks (Ethereum, Polygon, Base, Optimism, Arbitrum, BNB Chain, Avalanche). For custom deployments, pass `--delegate-address 0x...` explicitly.

## API

TypeScript server HTTP API:

| Endpoint       | Method | Description                                          |
| -------------- | ------ | ---------------------------------------------------- |
| `/verify`      | `POST` | Verify a signed payment (read-only, no state change) |
| `/settle`      | `POST` | Verify + submit Type 4 transaction on-chain          |
| `/supported`   | `GET`  | List supported schemes, networks, and signers        |
| `/healthcheck` | `GET`  | Server health status                                 |

Request body for `/verify` and `/settle`:

```json
{
  "paymentPayload": {
    "payload": {
      "authorization": {
        "contractAddress": "0x...",
        "chainId": 1,
        "nonce": 0,
        "r": "0x...",
        "s": "0x...",
        "yParity": 0
      },
      "intent": {
        "token": "0x...",
        "amount": "1000000",
        "to": "0x...",
        "nonce": "123",
        "deadline": "1700000000"
      },
      "signature": "0x..."
    }
  },
  "paymentRequirements": {
    "scheme": "eip7702",
    "network": "eip155:1",
    "asset": "0x...",
    "amount": "1000000",
    "payTo": "0x..."
  }
}
```

## Verification Checks

The facilitator performs these checks before settlement:

1. Recover signer from EIP-7702 authorization
2. Verify delegate contract address is trusted
3. Verify EIP-712 intent signature matches authorization signer
4. Check intent matches payment requirements (recipient, amount, asset)
5. Check deadline has not expired
6. Check nonce has not been used (replay protection)
7. Check payer has sufficient token/ETH balance on-chain

## Supported Mechanisms

This facilitator supports **both** mechanisms simultaneously:

|                   | ERC-3009 (`exact` scheme)                           | EIP-7702 (`eip7702` scheme)    |
| ----------------- | --------------------------------------------------- | ------------------------------ |
| **Token support** | Only tokens with `transferWithAuthorization` (USDC) | Any ERC-20 (USDT) + native ETH |
| **Mechanism**     | Token-level authorization                           | Account-level delegation       |
| **Smart wallets** | Requires EIP-6492 for counterfactual                | Direct EOA delegation          |
| **Gas**           | Relayer pays gas                                    | Relayer pays gas               |
| **Chain support** | Chains with USDC deployment                         | Any EVM chain with EIP-7702    |

## License

MIT
