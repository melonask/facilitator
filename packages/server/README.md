# @facilitator/server

Unified x402 facilitator server supporting **both** EIP-7702 (any ERC-20 like USDT + native ETH) and ERC-3009 (USDC) payment mechanisms.

## Installation

```bash
npm install -g @facilitator/server
```

## Usage

### Defaults (All Known Chains)

Run on all 7 supported networks with default public RPCs:

```bash
npx @facilitator/server --relayer-key 0x...
```

This enables Ethereum, Optimism, BNB Chain, Polygon, Base, Arbitrum, and Avalanche automatically.

### Specific Chains

Three `--chain` formats are supported:

```bash
# Chain ID with custom RPC
--chain 8453=https://mainnet.base.org

# Custom RPC only (chain ID auto-detected)
--chain https://mainnet.base.org

# Chain ID only (uses default public RPC)
--chain 8453
```

Repeat `--chain` for multiple chains:

```bash
npx @facilitator/server \
  --relayer-key 0x... \
  --chain 1=https://eth.llamarpc.com \
  --chain 137=https://polygon-rpc.com
```

### CLI Options

| Option               | Default     | Description                                                                 |
| -------------------- | ----------- | --------------------------------------------------------------------------- |
| `--port`             | `8080`      | Server port                                                                 |
| `--host`             | `0.0.0.0`   | Server host                                                                 |
| `--relayer-key`      | required    | Private key (hex) — pays gas                                                |
| `--chain`            | all known   | Chain config (repeatable). Formats: `id=url`, `url`, or `id`                |
| `--delegate-address` | auto-detect | Deployed `Delegate.sol` address (overrides known preset for **all** chains) |
| `--db`               | optional    | Database for persistent nonce tracking and settlement history               |

### API Endpoints

| Endpoint       | Method | Description                                                |
| -------------- | ------ | ---------------------------------------------------------- |
| `/verify`      | `POST` | Verify payment signatures and balance (read-only)          |
| `/settle`      | `POST` | Verify + submit on-chain transaction                       |
| `/supported`   | `GET`  | Supported schemes, networks, signers                       |
| `/healthcheck` | `GET`  | `{ status: "ok" }`                                         |
| `/info`        | `GET`  | Relayer ETH balance per chain                              |
| `/settlements` | `GET`  | Settlement history (`?payer=0x...`, optional `&chainId=1`) |

## Database

By default, nonce state and settlement history are stored in memory and lost on restart. Use `--db` to persist them.

### SQLite

Pass a local file path:

```bash
npx @facilitator/server --relayer-key 0x... --chain 8453 --db ./facilitator.db
```

### PostgreSQL

Pass a connection string:

```bash
npx @facilitator/server --relayer-key 0x... --chain 8453 --db postgres://user:pass@localhost:5432/facilitator
```

Or use standard PostgreSQL environment variables (`PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGPORT`) or `DATABASE_URL`:

```bash
PGHOST=localhost PGDATABASE=facilitator PGUSER=postgres PGPASSWORD=secret \
  npx @facilitator/server --relayer-key 0x... --chain 8453
```

Tables are created automatically on startup. No migration step required.

> **Note:** Without `--db` or PG environment variables, the server falls back to an in-memory store with a warning. Nonce replay protection and settlement records will be lost on restart — not recommended for production.

### Schema

**`used_nonces`** — Tracks consumed nonces to prevent replay attacks:

| Column       | Type      | Description                          |
| ------------ | --------- | ------------------------------------ |
| `nonce`      | text      | Composite key: `chainId:payer:nonce` |
| `chain_id`   | int       | EVM chain ID                         |
| `payer`      | text      | Signer address                       |
| `token`      | text      | Asset address                        |
| `created_at` | timestamp | When the nonce was consumed          |

**`settlements`** — Audit trail of settled payments:

| Column         | Type      | Description                             |
| -------------- | --------- | --------------------------------------- |
| `tx_hash`      | text      | On-chain transaction hash (primary key) |
| `chain_id`     | int       | EVM chain ID                            |
| `payer`        | text      | Buyer/signer address                    |
| `payee`        | text      | Recipient address                       |
| `token`        | text      | ERC-20 address or zero address for ETH  |
| `amount`       | text      | Transfer amount                         |
| `nonce`        | text      | Intent nonce                            |
| `status`       | text      | `confirmed` or `reverted`               |
| `block_number` | int       | Block number (nullable)                 |
| `created_at`   | timestamp | Settlement time                         |

## Supported Mechanisms

| Mechanism | Scheme    | Token Support                                  | How It Works              |
| --------- | --------- | ---------------------------------------------- | ------------------------- |
| EIP-7702  | `eip7702` | Any ERC-20 (USDT, DAI) + native ETH            | Account-level delegation  |
| ERC-3009  | `exact`   | Tokens with `transferWithAuthorization` (USDC) | Token-level authorization |

## Dependencies

- [`@facilitator/eip7702`](../eip7702) — EIP-7702 mechanism implementation
- [`@x402/core`](https://github.com/coinbase/x402) — Protocol types and facilitator interface
- [`@x402/evm`](https://github.com/coinbase/x402) — ERC-3009 / Permit2 mechanism implementation
- [`viem`](https://viem.sh) — Ethereum client
- [`drizzle-orm`](https://orm.drizzle.team) — Database ORM (SQLite + PostgreSQL)
- [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) — SQLite driver
- [`pg`](https://node-postgres.com) — PostgreSQL driver

## License

MIT
