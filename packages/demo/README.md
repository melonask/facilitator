# @facilitator/demo

<img src="https://raw.githubusercontent.com/melonask/facilitator/refs/heads/main/packages/demo/public/demo.gif" alt="Web app showing demo agents for the x402 EIP-7702 proposal, automatic purchase between agents via API.">

Interactive web visualizer for the x402 EIP-7702 payment protocol. Runs a buyer agent, seller agent, and facilitator server locally, then animates each step of the protocol in real time.

## What It Shows

The demo runs a complete payment cycle between two automated agents:

```
  Buyer Agent             Seller Agent            Facilitator
       |                       |                       |
  1.   |--- GET /weather ----->|                       |
  2.   |<-- 402 Payment Req ---|                       |
  3.   | (signs EIP-712 + 7702)|                       |
  4.   |--- GET + payment ---->|                       |
  5.   |                       |--- verify + settle -->|
       |                       |     (on-chain tx)     |
  6.   |<-- 200 weather data --|<-- tx confirmed ------|
```

The web UI highlights each step with animated packet flows, signature status indicators, transaction hashes, and an explanation panel describing what's happening at each stage.

## Prerequisites

- [Bun](https://bun.sh) >= 1.1.0
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for Anvil local chain)

## Quick Start

```bash
git clone https://github.com/melonask/facilitator && cd facilitator
bun install
bun run demo
```

This starts all services and opens the visualizer.

## Ports

| Service     | Port   | Description                               |
| ----------- | ------ | ----------------------------------------- |
| Demo UI     | `8080` | Web visualizer + SSE log stream           |
| Seller      | `4000` | Weather API (returns 402 without payment) |
| Buyer       | `4001` | Agent that auto-purchases from the seller |
| Facilitator | `3000` | Payment verification + settlement         |
| Anvil       | `8545` | Local Ethereum chain                      |

## UI Controls

- **INITIATE** -- trigger a manual purchase cycle
- **AUTO / STEP** -- toggle between auto-play and step-through mode
- **NEXT** -- advance one step (in step mode)
