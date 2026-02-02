# x402 Facilitator

<img src="https://raw.githubusercontent.com/melonask/facilitator/refs/heads/main/packages/demo/public/demo.gif" alt="Web app showing demo agents for the x402 EIP-7702 proposal, automatic purchase between agents via API.">

Self-hosted payment facilitator for the [x402 protocol](https://www.x402.org/). Settles ERC-20 and native ETH payments on any EVM chain using EIP-7702 delegation -- buyers never pay gas.

## How It Works

Sellers protect HTTP endpoints with a `402 Payment Required` response. Buyers sign an EIP-712 payment intent and an EIP-7702 authorization off-chain. The facilitator verifies signatures, checks balances, and submits a Type 4 transaction as the relayer.

```
  Buyer                    Seller                  Facilitator
    |--- GET /resource ----->|                         |
    |<-- 402 + requirements -|                         |
    | (sign intent off-chain)|                         |
    |--- GET + PAYMENT-SIG ->|--- POST /verify ------->|
    |                        |--- POST /settle ------->|
    |                        |     (Type 4 tx)         |
    |<-- 200 + data ---------|<-- { txHash } ----------|
```

## Quick Start

```bash
bunx @facilitator/server \
  --relayer-private-key 0x... \
  --delegate-address 0x... \
  --rpc-url 1=https://eth-mainnet.g.alchemy.com/v2/...
```

See [`packages/server`](packages/server) for full configuration reference.

## Monorepo Structure

| Package                                    | Description                                                   |
| ------------------------------------------ | ------------------------------------------------------------- |
| [`packages/server`](packages/server)       | Facilitator HTTP server (verify + settle endpoints)           |
| [`packages/contracts`](packages/contracts) | Delegate.sol -- EIP-7702 delegation contract (Foundry)        |
| [`packages/demo`](packages/demo)           | Interactive web visualizer with automated buyer/seller agents |

## Running the Demo

```bash
git clone https://github.com/melonask/facilitator && cd facilitator
bun install
bun run demo
```

This starts Anvil, deploys contracts, launches the facilitator server + demo agents, and opens the visualizer.

## Security Considerations

- The relayer private key can only execute pre-signed intents through the Delegate contract. It has no custody of user funds.
- Each payment intent includes a nonce and deadline to prevent replay and expiration attacks.
- The Delegate contract verifies EIP-712 signatures on-chain before executing transfers.
- All off-chain verification (signature recovery, balance checks, nonce tracking) is re-performed during settlement.

## License

MIT
