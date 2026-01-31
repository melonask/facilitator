# @facilitator/server

x402 payment facilitator server implementing gasless ERC-20 and native ETH transfers via [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) delegated transactions.

A **relayer** pays the gas on behalf of users. Users sign an EIP-712 payment intent and an EIP-7702 authorization that delegates their EOA to the [`Delegate`](../contracts/src/Delegate.sol) contract. The facilitator verifies both signatures off-chain, then submits a single Type 4 transaction to settle the payment on-chain.

## Prerequisites

- [Bun](https://bun.sh/) v1.1+
- Access to an EVM RPC endpoint (Anvil for local development)
- A deployed `Delegate` contract (see `packages/contracts`)

## Quick Start

```sh
# Install dependencies
bun install

# Set environment variables (or create a .env file — Bun loads it automatically)
export RELAYER_PRIVATE_KEY="0x..."
export DELEGATE_ADDRESS="0x..."
export RPC_URL_31337="http://127.0.0.1:8545"

# Start the server
bun run start

# Or with file-watching for development
bun run dev
```

The server starts on port `3000` by default. Override with the `PORT` environment variable.

## Environment Variables

| Variable              | Required | Description                                               |
| --------------------- | -------- | --------------------------------------------------------- |
| `RELAYER_PRIVATE_KEY` | Yes      | Private key of the relayer account that pays gas          |
| `DELEGATE_ADDRESS`    | Yes      | Deployed `Delegate` contract address                      |
| `RPC_URL_<chainId>`   | Yes      | RPC endpoint per chain (e.g. `RPC_URL_1`, `RPC_URL_8453`) |
| `PORT`                | No       | Server port (default: `3000`)                             |

## API

### `GET /healthcheck`

Returns server uptime and status.

### `GET /supported`

Returns supported payment schemes, networks, and the relayer signer address.

### `GET /discovery/resources?limit=100&offset=0`

Lists resources that have been settled through this facilitator (the "bazaar").

### `POST /verify`

Off-chain verification of a payment intent. Checks:

1. EIP-7702 authorization signature recovery
2. Delegate contract address trust
3. EIP-712 intent signature validity
4. Deadline expiration
5. Nonce uniqueness
6. Payer balance (ERC-20 `balanceOf` or native ETH `getBalance`)

**Request body:**

```json
{
  "paymentPayload": { "..." },
  "paymentRequirements": { "..." }
}
```

### `POST /settle`

Verifies and then submits the payment transaction on-chain. Sends a Type 4 (EIP-7702) transaction through the relayer. If the payer's EOA already has delegated code, the authorization list is omitted.

**Request body:** Same as `/verify`.

## Asset Types

- **ERC-20 tokens:** Set `asset` to the token contract address. Uses `Delegate.transfer()`.
- **Native ETH:** Set `asset` to `0x0000000000000000000000000000000000000000`. Uses `Delegate.transferEth()`.

## Architecture

```
src/
  index.ts      HTTP server (Bun.serve) and route handlers
  config.ts     Environment config, relayer account, RPC client factory
  mechanism.ts  EIP-7702 verification and settlement logic
  storage.ts    In-memory nonce tracker and discovery catalog
  types.ts      x402 protocol and EIP-7702 type definitions
  abi.ts        Solidity ABI fragments for Delegate and ERC-20
test/
  integration.test.ts   End-to-end test against Anvil
```

## Testing

Tests require [Foundry](https://getfoundry.sh/) (for Anvil) and compiled contract artifacts.

```sh
# Build contracts first (from the monorepo root)
cd packages/contracts && forge build

# Run integration tests
cd packages/server && bun test
```

The integration test suite:

1. Starts a local Anvil instance
2. Deploys `Delegate` and `MockERC20` contracts
3. Starts the facilitator server
4. Executes full verify + settle flows for both ERC-20 and native ETH transfers
5. Asserts on-chain balances after settlement

## License

MIT
