# Self-Hosted Facilitator — Setup & API

## Why Self-Host?

The x402 ecosystem has public facilitators (e.g., Coinbase CDP at `https://api.cdp.coinbase.com/platform/v2/x402`), but they only support the `exact` scheme (ERC-3009 / USDC). To accept **any ERC-20 token** (USDT, DAI, etc.) or **native ETH** via EIP-7702, you need a self-hosted facilitator.

A self-hosted facilitator also gives you:

- Full control over nonce replay protection (with a persistent database)
- Settlement audit trail
- Custom delegate contract addresses
- No dependency on third-party uptime

## Installation

```bash
npm install -g @facilitator/server
# or use via npx
npx @facilitator/server --help
```

## CLI Options

| Option               | Default     | Description                                                   |
| -------------------- | ----------- | ------------------------------------------------------------- |
| `--port`             | `8080`      | Server port                                                   |
| `--host`             | `0.0.0.0`   | Server host                                                   |
| `--relayer-key`      | required    | Private key (hex) for the relayer that pays gas               |
| `--chain`            | all known   | Chain config (repeatable). Formats: `id=url`, `url`, or `id`. |
| `--delegate-address` | auto-detect | Override the Delegate contract address for all chains         |
| `--db`               | optional    | Database path (SQLite) or connection string (PostgreSQL)      |

## Running the Server

### Defaults (All Known Chains)

Run on all 7 supported networks with default public RPCs:

```bash
npx @facilitator/server --relayer-key 0x...
```

### Local Testing (Anvil)

When testing locally against Anvil (which must be started with `--hardfork prague`), bind specifically to chain `31337`:

```bash
npx @facilitator/server \
  --relayer-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --chain 31337=http://127.0.0.1:8545
```

### Specific Chains

Three `--chain` formats:

```bash
# Chain ID with custom RPC
--chain 8453=https://mainnet.base.org

# Custom RPC only (chain ID auto-detected)
--chain https://mainnet.base.org

# Chain ID only (uses default public RPC)
--chain 8453
```

### With Database (Recommended for Production)

```bash
# SQLite
npx @facilitator/server \
  --relayer-key 0x... \
  --db ./facilitator.db

# PostgreSQL
npx @facilitator/server \
  --relayer-key 0x... \
  --db postgres://user:pass@localhost:5432/facilitator

# PostgreSQL via env vars
PGHOST=localhost PGDATABASE=facilitator npx @facilitator/server \
  --relayer-key 0x...
```

Without `--db`, nonce state and settlement history are in-memory only (lost on restart).

## HTTP API

| Endpoint       | Method | Description                                                |
| -------------- | ------ | ---------------------------------------------------------- |
| `/verify`      | `POST` | Verify a signed payment (read-only, no state change)       |
| `/settle`      | `POST` | Verify + submit Type 4 transaction on-chain                |
| `/supported`   | `GET`  | List supported schemes, networks, and signers              |
| `/healthcheck` | `GET`  | `{ status: "ok" }`                                         |
| `/info`        | `GET`  | Relayer ETH balance per chain                              |
| `/settlements` | `GET`  | Settlement history (`?payer=0x...`, optional `&chainId=1`) |

### Request Body for `/verify` and `/settle`

The `paymentPayload` must follow the x402 V2 format, which includes the `resource` and `accepted` fields alongside the scheme-specific `payload`.

```json
{
  "paymentPayload": {
    "x402Version": 2,
    "resource": {
      "url": "https://api.example.com/data",
      "description": "API Access"
    },
    "accepted": {
      "scheme": "eip7702",
      "network": "eip155:1",
      "asset": "0x...",
      "amount": "1000000",
      "payTo": "0x...",
      "maxTimeoutSeconds": 300
    },
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
    "payTo": "0x...",
    "maxTimeoutSeconds": 300,
    "extra": {}
  }
}
```

### Verification Checks

The facilitator performs these checks before settlement:

1. Recover signer from EIP-7702 authorization
2. Verify delegate contract address is trusted
3. Verify EIP-712 intent signature matches authorization signer
4. Check intent matches payment requirements (recipient, amount, asset)
5. Check deadline has not expired
6. Check nonce has not been used (replay protection)
7. Check payer has sufficient token/ETH balance on-chain

## Supported Mechanisms

| Mechanism | Scheme    | Token Support                                    | How It Works                                 |
| --------- | --------- | ------------------------------------------------ | -------------------------------------------- |
| EIP-7702  | `eip7702` | Any ERC-20 + native ETH                          | Account-level delegation, gasless for buyer  |
| ERC-3009  | `exact`   | USDC and tokens with `transferWithAuthorization` | Token-level authorization, gasless for buyer |

Both mechanisms are registered simultaneously — the scheme in the payment requirements determines which is used.
