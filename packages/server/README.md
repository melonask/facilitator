# @facilitator/server

Unified x402 facilitator server supporting **both** EIP-7702 (any ERC-20 like USDT + native ETH) and ERC-3009 (USDC) payment mechanisms.

## Installation

```bash
npm install -g @facilitator/server
```

## Usage

### Multi-Chain

Run the server with support for multiple chains and fallback RPCs:

```bash
npx @facilitator/server \
  --relayer-key 0x... \
  --chain 1=https://,https:// \
  --chain 137=https://polygon-rpc.com
```

Format: `--chain <chainId>=<rpcUrl1>,<rpcUrl2>,...`

### Single-Chain

```bash
npx @facilitator/server \
  --relayer-key 0x... \
  --rpc-url https://mainnet.infura.io/v3/...
```

The chain ID is auto-detected from the RPC endpoint.

### CLI Options

| Option               | Default     | Description                                                                 |
| -------------------- | ----------- | --------------------------------------------------------------------------- |
| `--port`             | `8080`      | Server port                                                                 |
| `--host`             | `0.0.0.0`   | Server host                                                                 |
| `--relayer-key`      | required    | Private key (hex) — pays gas                                                |
| `--chain`            | optional    | Config per chain: `id=url1,url2`. Can be used multiple times.               |
| `--delegate-address` | auto-detect | Deployed `Delegate.sol` address (overrides known preset for **all** chains) |
| `--rpc-url`          | optional    | **Legacy:** Single EVM JSON-RPC endpoint (auto-detects chain ID)            |

### API Endpoints

| Endpoint       | Method | Description                                       |
| -------------- | ------ | ------------------------------------------------- |
| `/verify`      | `POST` | Verify payment signatures and balance (read-only) |
| `/settle`      | `POST` | Verify + submit on-chain transaction              |
| `/supported`   | `GET`  | Supported schemes, networks, signers              |
| `/healthcheck` | `GET`  | `{ status: "ok" }`                                |
| `/info`        | `GET`  | Relayer ETH balance                               |

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

## License

MIT
