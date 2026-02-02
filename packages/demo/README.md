# x402 EIP-7702 Demo

<img src="https://raw.githubusercontent.com/melonask/facilitator/refs/heads/main/packages/demo/public/demo.gif" alt="x402 EIP-7702 demo — autonomous agent-to-agent payment">

Interactive demo showing the x402 payment protocol with EIP-7702 gasless transfers. Includes autonomous buyer/seller agents and a real-time web visualization.

## Quick Start

<details>
  <summary>Requires: Foundry (for Anvil)</summary>

```bash
curl -L https://foundry.paradigm.xyz | bash
```

</details>

```bash
npx @facilitator/demo
```

> **Note:** You can also use `bunx`, `yarn dlx`, or `pnpm dlx` if you prefer.

This starts Anvil, deploys contracts, funds accounts, starts agents and web UI, then prints a command to run the facilitator:

```bash
npx @facilitator/eip7702 --relayer-key 0x... --delegate-address 0x... --rpc-url http://127.0.0.1:8545
```

Run that in a **new terminal**, then open `http://localhost:3030` and click **INITIATE**.

## Topology

```
+------------------+              +------------------+
|  BUYER AGENT     |              |  SELLER AGENT    |
|  :4000           |---- x402 --->|  :4001           |
|  (1000 USDT)     |              |  (weather API)   |
+------------------+              +--------+---------+
                                           |
                                  +--------v---------+
                                  |  FACILITATOR     |
                                  |  :8080           |
                                  +--------+---------+
                                           |
                                  +--------v---------+
                                  |  ANVIL           |
                                  |  :8545           |
                                  +------------------+

                                  +------------------+
                                  |  WEB UI          |
                                  |  :3030           |
                                  +------------------+
```

| Service      | Port | Description                            |
| ------------ | ---- | -------------------------------------- |
| Anvil        | 8545 | Local EVM chain (chain ID 31337)       |
| Buyer Agent  | 4000 | Autonomous consumer with ERC-20 tokens |
| Seller Agent | 4001 | Weather data provider (1 USDT/request) |
| Facilitator  | 8080 | Payment verification and settlement    |
| Web UI       | 3030 | Real-time protocol visualization       |

## Web UI

The web UI shows each step of the x402 protocol:

1. **REQUEST** -- Buyer sends `GET /weather` to Seller
2. **402 RESPONSE** -- Seller responds with payment requirements
3. **SIGN** -- Buyer signs EIP-712 intent + EIP-7702 authorization
4. **RETRY** -- Buyer resends with `PAYMENT-SIGNATURE` header
5. **VERIFY + SETTLE** -- Facilitator verifies and submits Type 4 tx
6. **DELIVER** -- Seller delivers weather data with tx receipt

Features:

- Auto/Step mode toggle for pacing
- Real-time balance tracking
- Signature and settlement detail panels
- SSE-based log streaming

## License

MIT
