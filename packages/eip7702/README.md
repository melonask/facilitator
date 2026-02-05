# @facilitator/eip7702

<img src="https://raw.githubusercontent.com/melonask/facilitator/refs/heads/main/packages/demo/public/demo.gif" alt="x402 EIP-7702 demo — autonomous agent-to-agent payment">

TypeScript implementation of the EIP-7702 payment scheme for the [x402](https://github.com/coinbase/x402) protocol. Plugs into `@x402/core` as a `SchemeNetworkFacilitator`.

## Installation

```bash
npm install @facilitator/eip7702
```

> **Note:** You can also use `bun add`, `yarn add`, or `pnpm add` if you prefer.

## Usage

> **Standalone Server:** Use [`@facilitator/server`](../server) for a CLI server that supports both EIP-7702 and ERC-3009 mechanisms:
>
> ```bash
> npx @facilitator/server
>     --relayer-key 0x...
>     --rpc-url https://...
> ```

### As a Library

```typescript
import { Eip7702Mechanism } from "@facilitator/eip7702";
import { x402Facilitator } from "@x402/core/facilitator";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

const account = privateKeyToAccount("0x...");

const mechanism = new Eip7702Mechanism({
  // Optional — auto-detected on supported networks (Ethereum, Polygon, Base, Optimism, Arbitrum, BNB Chain, Avalanche).
  // Required for custom deployments or unsupported chains.
  // delegateAddress: "0x...",
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
facilitator.register(["eip155:1", "eip155:137"], mechanism);

// Use facilitator.verify() and facilitator.settle()
```

### Supported Networks

`KNOWN_DELEGATE_ADDRESSES` includes Ethereum, Polygon, Base, Optimism, Arbitrum, BNB Chain, and Avalanche. For other networks, pass the delegate address explicitly when constructing `Eip7702Mechanism`.

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
