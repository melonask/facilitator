# @facilitator/eip7702

TypeScript implementation of the EIP-7702 payment scheme for the [x402](https://github.com/coinbase/x402) protocol. Plugs into `@x402/core` as a `SchemeNetworkFacilitator`.

## Installation

```bash
npm install @facilitator/eip7702
```

> **Note:** You can also use `bun add`, `yarn add`, or `pnpm add` if you prefer.

## Usage

### As a Library

```typescript
import { Eip7702Mechanism } from "@facilitator/eip7702";
import { x402Facilitator } from "@x402/core/facilitator";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

const account = privateKeyToAccount("0x...");

const mechanism = new Eip7702Mechanism({
  delegateAddress: "0x...", // Deployed Delegate.sol address
  relayerAccount: account, // Pays gas for settlements
  clientProvider: {
    getPublicClient: () =>
      createPublicClient({ chain: mainnet, transport: http() }),
    getWalletClient: () =>
      createWalletClient({ chain: mainnet, transport: http(), account }),
  },
  nonceManager: {
    // Replay protection
    checkAndMark: (nonce) => {
      /* mark nonce as used, return false if already used */
    },
    has: (nonce) => {
      /* return true if nonce already used */
    },
  },
});

const facilitator = new x402Facilitator();
facilitator.register(["eip155:1"], mechanism);

// Use facilitator.verify() and facilitator.settle()
```

### As a Standalone Server

```bash
npx @facilitator/eip7702 \
  --relayer-key 0x... \
  --delegate-address 0x... \
  --rpc-url https://mainnet.infura.io/v3/...
```

> **Note:** You can also use `bunx`, `yarn dlx`, or `pnpm dlx` if you prefer.

The chain ID is auto-detected from the RPC endpoint.

### CLI Options

| Option               | Default   | Description                     |
| -------------------- | --------- | ------------------------------- |
| `--port`             | `8080`    | Server port                     |
| `--host`             | `0.0.0.0` | Server host                     |
| `--relayer-key`      | required  | Private key (hex) — pays gas    |
| `--delegate-address` | required  | Deployed `Delegate.sol` address |
| `--rpc-url`          | required  | EVM JSON-RPC endpoint           |

### API Endpoints

| Endpoint       | Method | Description                                       |
| -------------- | ------ | ------------------------------------------------- |
| `/verify`      | `POST` | Verify payment signatures and balance (read-only) |
| `/settle`      | `POST` | Verify + submit EIP-7702 Type 4 transaction       |
| `/supported`   | `GET`  | Supported schemes, networks, signers              |
| `/healthcheck` | `GET`  | `{ status: "ok" }`                                |
| `/info`        | `GET`  | Relayer ETH balance                               |

## Verification Flow

```
verify(payload, requirements)
  |
  +-- Check accepted requirements match
  +-- Verify authorization chainId == requirement network
  +-- Recover signer from EIP-7702 authorization
  +-- Verify EIP-712 intent signature (PaymentIntent / EthPaymentIntent)
  +-- Check intent matches requirements (recipient, amount, asset)
  +-- Check deadline not expired (with 6s grace)
  +-- Check nonce not used
  +-- Check on-chain balance (ERC-20 balanceOf / ETH getBalance)
  |
  +-> { isValid: true, payer: "0x..." }
```

## Settlement Flow

```
settle(payload, requirements)
  |
  +-- verify(consumeNonce=true)
  +-- Encode Delegate.transfer() or Delegate.transferEth() calldata
  +-- Check if payer EOA already has delegate code
  |     YES -> send regular transaction
  |     NO  -> send Type 4 tx with authorizationList
  +-- Wait for receipt (30s timeout)
  |
  +-> { success: true, transaction: "0x...", network: "eip155:1" }
```

## Dependencies

- [`@x402/core`](https://github.com/coinbase/x402) — Protocol types and facilitator interface
- [`viem`](https://viem.sh) — Ethereum client (signature verification, contract calls, transaction submission)

## License

MIT
