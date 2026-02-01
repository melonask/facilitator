# @facilitator/server

Self-hosted x402 payment facilitator server. Verifies and settles **any ERC-20 token** (including USDT) and native ETH payments using EIP-7702 delegated transactions.

A **relayer** account pays gas on behalf of users. Users sign two things:

1. **EIP-712 PaymentIntent** — what to pay (token, amount, recipient)
2. **EIP-7702 Authorization** — delegate their EOA to the `Delegate` contract

The facilitator verifies both signatures off-chain, then submits a single Type 4 transaction to settle on-chain.

```
  Verification & Settlement Flow

  Client                    Facilitator                Blockchain
    │                           │                          │
    │── POST /verify ──────────>│                          │
    │   {paymentPayload,        │── recover signer         │
    │    paymentRequirements}   │── verify EIP-712 sig     │
    │                           │── check deadline         │
    │                           │── check nonce            │
    │                           │── check balance ────────>│
    │<── {isValid, payer} ──────│                          │
    │                           │                          │
    │── POST /settle ──────────>│                          │
    │                           │── verify (same checks)   │
    │                           │── encode Delegate call   │
    │                           │── send Type 4 tx ───────>│
    │                           │   (EIP-7702 + call data) │
    │                           │<── receipt ──────────────│
    │<── {success, tx hash} ────│                          │
```

## Quick Start

```sh
bun install

# Using environment variables
export RELAYER_PRIVATE_KEY="0x..."
export DELEGATE_ADDRESS="0x..."
export RPC_URL_31337="http://127.0.0.1:8545"
bun run start

# Or pass everything via CLI flags
bunx @facilitator/server \
  --relayer-private-key 0x... \
  --delegate-address 0x... \
  --rpc-url 31337=http://127.0.0.1:8545

# Mix and match — CLI flags override env vars
export RELAYER_PRIVATE_KEY="0x..."
bunx @facilitator/server --port 8080 --delegate-address 0x...

# Hot-reload for development
bun run dev
```

The server starts on `0.0.0.0:3000` by default. Override with CLI flags or environment variables.

## CLI Options

```
Usage: facilitator-server [options]

Options:
  -p, --port <port>              Server port (default: 3000, env: PORT)
  -H, --host <host>              Server hostname (default: "0.0.0.0", env: HOST)
      --relayer-private-key <key>        Relayer private key (env: RELAYER_PRIVATE_KEY)
      --delegate-address <addr>  Delegate contract address (env: DELEGATE_ADDRESS)
      --rpc-url <chainId=url>    RPC endpoint, repeatable (env: RPC_URL_<chainId>)
  -h, --help                     Show this help message
```

CLI flags take precedence over environment variables. The `--rpc-url` flag can be repeated for multiple chains:

```sh
bunx @facilitator/server \
  --rpc-url 1=https://eth.rpc.io \
  --rpc-url 8453=https://base.rpc.io
```

## Environment Variables

| Variable              | Required | Description                                               |
| --------------------- | -------- | --------------------------------------------------------- |
| `RELAYER_PRIVATE_KEY` | Yes      | Private key of the account that pays gas for settlements  |
| `DELEGATE_ADDRESS`    | Yes      | Address of the deployed `Delegate` contract               |
| `RPC_URL_<chainId>`   | Yes      | RPC endpoint per chain (e.g. `RPC_URL_1`, `RPC_URL_8453`) |
| `PORT`                | No       | Server port (default: `3000`)                             |
| `HOST`                | No       | Server hostname (default: `"0.0.0.0"`)                    |

## API

### `GET /healthcheck`

Returns server status and uptime.

**Response:**

```json
{ "status": "ok", "uptime": 123.45, "timestamp": 1706745600000 }
```

### `GET /supported`

Returns supported payment schemes, networks, and the relayer signer address.

**Response:**

```json
{
  "kinds": [{ "x402Version": 2, "scheme": "eip7702", "network": "eip155:*" }],
  "extensions": ["bazaar"],
  "signers": { "eip155:*": ["0xRelayer..."] },
  "delegateContract": "0xDelegate..."
}
```

### `GET /discovery/resources?limit=100&offset=0`

Lists resources that have been settled through this facilitator (the "bazaar").

### `POST /verify`

Read-only off-chain verification of a payment payload. Does not consume the nonce or submit any transaction. Checks:

| Step | Check                                      | Failure Reason                |
| ---- | ------------------------------------------ | ----------------------------- |
| 1    | Recover signer from EIP-7702 authorization | `Untrusted Delegate Contract` |
| 2    | Verify EIP-712 intent signature            | `Invalid Intent Signature`    |
| 3    | Check deadline has not passed              | `Deadline Expired`            |
| 4    | Check nonce has not been used              | `Nonce Used`                  |
| 5    | Check payer has sufficient balance         | `Insufficient Balance`        |

**Request:**

```json
{
  "paymentPayload": { "x402Version": 2, "resource": {...}, "accepted": {...}, "payload": {...} },
  "paymentRequirements": { "scheme": "eip7702", "network": "eip155:31337", "asset": "0x...", "amount": "1000000000000000000", "payTo": "0x..." }
}
```

**Response:**

```json
{ "isValid": true, "payer": "0xBuyer..." }
```

### `POST /settle`

Re-verifies (consuming the nonce this time) and submits the payment on-chain. Sends a Type 4 (EIP-7702) transaction through the relayer. If the payer already has delegated code, the authorization list is omitted for gas efficiency. Always call `/verify` first to check validity without side effects.

**Request:** Same as `/verify`.

**Response:**

```json
{
  "success": true,
  "transaction": "0xTxHash...",
  "network": "eip155:31337",
  "payer": "0xBuyer..."
}
```

### `GET /balance`

Returns the relayer's ETH balance (debug endpoint).

## Asset Types

| Asset            | `asset` field                                | Contract call            |
| ---------------- | -------------------------------------------- | ------------------------ |
| Any ERC-20 token | Token contract address                       | `Delegate.transfer()`    |
| Native ETH       | `0x0000000000000000000000000000000000000000` | `Delegate.transferEth()` |

## Source Structure

```
src/
├── index.ts       HTTP server (Bun.serve) — route handlers
├── config.ts      Environment config, relayer account, RPC client factory
├── mechanism.ts   EIP-7702 verification and settlement logic
├── storage.ts     In-memory nonce tracker and bazaar catalog
├── types.ts       x402 protocol and EIP-7702 type definitions
└── abi.ts         Solidity ABI fragments for Delegate and ERC-20

test/
├── integration.test.ts   End-to-end tests against Anvil
├── Delegate.json         Compiled contract artifact
└── MockERC20.json        Compiled token artifact
```

## Testing

Tests require [Foundry](https://getfoundry.sh/) (for Anvil) and compiled contract artifacts in `test/`.

```sh
# Build contracts first (from monorepo root)
bun run build:contracts

# Run integration tests
bun test
```

The test suite automatically:

1. Starts a local Anvil instance
2. Deploys `Delegate` and `MockERC20` contracts
3. Starts the facilitator server
4. Executes verify + settle flows for both ERC-20 and native ETH
5. Asserts on-chain balances after settlement

## License

MIT
