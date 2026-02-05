# Facilitator Dashboard

<img src="https://raw.githubusercontent.com/melonask/facilitator/refs/heads/main/packages/dash/public/scr.png" alt="x402 EIP-7702 Facilitator Dashboard">

A real-time, local-first dashboard for monitoring EIP-7702 facilitators. Track balances, transaction history, gas spending, and token transfers across multiple EVM chains.

```bash
npx @facilitator/dash
```

> **Note:** You can also use `bunx`, `yarn dlx`, or `pnpm dlx` if you prefer.

## Features

### Overview Dashboard

- **Key Metrics** — Total facilitators, aggregate balance, transaction count, and gas spent
- **Trend Analysis** — Period-over-period comparison with percentage changes
- **Network Distribution** — Visual breakdown of transactions across chains
- **Activity Charts** — Transaction volume and gas spending over time (1H, 24H, 7D, 30D, All)
- **Top Tokens** — Pie chart of most frequently transferred ERC-20 tokens
- **Top Destinations** — Most common transaction recipients
- **Gas Prices** — Live gas prices per network
- **Low Balance Alerts** — Warnings for facilitators below 0.1 ETH

### Facilitators

- Monitor individual facilitator balances and transaction counts
- Balance history sparklines
- Per-network grouping

### Transactions

- Full transaction history with filtering
- Token transfer details (symbol, amount, recipient)
- Gas cost tracking per transaction
- Click-through to transaction details

### Settings

- **Networks** — Add custom RPC endpoints for any EVM chain
- **Facilitators** — Track addresses by public address or import via private key
- **Danger Zone** — Clear all local data

## Local-First Storage

All data is stored locally in your browser using IndexedDB:

- Networks and facilitator configurations persist across sessions
- Transaction history (up to 5,000 transactions)
- Balance history (up to 2,000 data points per facilitator)
- Token metadata cache
- Theme preference (dark/light/system)

No data is sent to external servers. The dashboard connects directly to your configured RPC endpoints.

## Default Configuration

The dashboard comes pre-configured with Anvil Local (`http://127.0.0.1:8545`) for easy testing with the demo package.

## License

MIT
