# @facilitator/server

<img src="https://raw.githubusercontent.com/melonask/facilitator/refs/heads/main/packages/demo/public/demo.gif" alt="Web app showing demo agents for the x402 EIP-7702 proposal, automatic purchase between agents via API.">

Self-hosted x402 payment facilitator server. Verifies and settles ERC-20 token payments using EIP-7702 delegation and EIP-3009/Permit2 authorization schemes -- buyers never pay gas.

## Security Model

The facilitator acts as a trusted intermediary between buyers and sellers:

1. **Buyer** signs an EIP-712 payment intent + EIP-7702 authorization (off-chain, no gas)
2. **Seller** forwards the signed payload to the facilitator for verification
3. **Facilitator** verifies signatures, checks balances, then submits a Type 4 transaction as the relayer (pays gas on behalf of the buyer)

The relayer private key has no custody of user funds -- it can only execute pre-signed intents through the Delegate contract.

## Architecture

```
  Buyer                    Seller                  Facilitator
    |                        |                         |
    |--- GET /resource ----->|                         |
    |<-- 402 + requirements -|                         |
    |                        |                         |
    | (sign EIP-712 + 7702)  |                         |
    |                        |                         |
    |--- GET + PAYMENT-SIG ->|                         |
    |                        |--- POST /verify ------->|
    |                        |<-- { isValid: true } ---|
    |                        |--- POST /settle ------->|
    |                        |     (Type 4 tx on-chain)|
    |                        |<-- { success, txHash } -|
    |<-- 200 + data ---------|                         |
```

## Quick Start

```bash
bunx @facilitator/server \
  --relayer-private-key 0x... \
  --delegate-address 0x... \
  --rpc-url 1=https://eth-mainnet.g.alchemy.com/v2/...
```

Or with environment variables:

```bash
RELAYER_PRIVATE_KEY=0x... \
DELEGATE_ADDRESS=0x... \
RPC_URL_1=https://eth-mainnet.g.alchemy.com/v2/... \
bunx @facilitator/server
```

## Configuration

| Variable              | CLI Flag                    | Default   | Description                                       |
| --------------------- | --------------------------- | --------- | ------------------------------------------------- |
| `RELAYER_PRIVATE_KEY` | `--relayer-private-key`     | --        | Private key for the relayer account (required)    |
| `RPC_URL_<chainId>`   | `--rpc-url <chainId>=<url>` | --        | RPC endpoint per chain (repeatable)               |
| `DELEGATE_ADDRESS`    | `--delegate-address`        | --        | Deployed Delegate.sol contract address (required) |
| `PORT`                | `-p, --port`                | `3000`    | Server port                                       |
| `HOST`                | `-H, --host`                | `0.0.0.0` | Server hostname                                   |

## API Endpoints

| Method | Path                   | Description                                                               |
| ------ | ---------------------- | ------------------------------------------------------------------------- |
| `GET`  | `/healthcheck`         | Returns `{ status, uptime, timestamp }`                                   |
| `GET`  | `/info`                | Relayer address + ETH balances per chain. Optional `?chainId=<id>` filter |
| `GET`  | `/supported`           | Lists supported schemes, networks, and signers                            |
| `GET`  | `/discovery/resources` | Bazaar catalog of settled resources. `?limit=&offset=&type=`              |
| `GET`  | `/verify`              | Schema description for the verify endpoint                                |
| `GET`  | `/settle`              | Schema description for the settle endpoint                                |
| `POST` | `/verify`              | Verify a payment payload (read-only, no nonce consumed)                   |
| `POST` | `/settle`              | Verify + execute on-chain settlement                                      |

## Supported Payment Schemes

- **eip7702** -- EIP-7702 delegation + EIP-712 signed intents. Works with any ERC-20 token (USDT, DAI, WETH, etc.) and native ETH.
- **exact** -- EIP-3009 `transferWithAuthorization` (USDC-style tokens) and Permit2 witness transfers.
