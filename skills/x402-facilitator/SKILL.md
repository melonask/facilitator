---
name: x402-facilitator
description: >-
  Guide for integrating x402 protocol payments into applications using @facilitator/eip7702 and @facilitator/server.
  Use this skill whenever a developer wants to accept payments on an API, build an agent that pays or receives money,
  add pay-per-request billing, integrate EIP-7702 gasless payments, set up an x402 facilitator,
  accept USDT/USDC/any ERC-20 via HTTP 402, or mentions x402, HTTP 402, payment-required, gasless transfers,
  EIP-7702 payments, or agent-to-agent payments — even if they don't explicitly name "x402" or "facilitator."
---

# x402 Integration Guide

This skill helps LLM developers integrate on-chain payments into their applications using the [x402](https://x402.org) protocol and the [facilitator](https://github.com/melonask/facilitator) packages.

## What x402 Does

x402 revives the HTTP `402 Payment Required` status code. Instead of API keys or subscriptions, a server returns 402 with payment requirements (amount, token, recipient). The client signs an off-chain authorization and re-sends the request with payment attached. A facilitator (relayer) verifies the signature and submits the on-chain transaction — the buyer never needs ETH for gas.

The key insight: **payments happen at the HTTP layer**. No accounts, no OAuth, no billing portal. Just: request → 402 → pay → 200.

## Two Integration Scenarios

### 1. You have an API and want to charge per request (Seller)

Your server returns 402 when a request arrives without payment, then verifies and settles the payment before delivering the resource. You can use the official `@x402/express` (or `@x402/hono`, `@x402/next`) middleware for automatic handling, or implement the 402 flow manually for full control.

Read `references/building-a-seller.md` for the complete flow with code examples.

### 2. You have an agent that pays other agents/services (Buyer)

Your client wraps `fetch` with `@x402/fetch` so 402 responses are handled automatically — the client signs the payment and re-sends the request transparently. For EIP-7702 payments (any ERC-20 or native ETH), you provide a `SchemeNetworkClient` implementation that signs EIP-712 intents and EIP-7702 authorizations using viem.

Read `references/building-a-buyer.md` for the complete client setup with code examples.

## Choose Your Payment Mechanism

| Mechanism | Scheme    | Tokens                                           | When to Use                                   |
| --------- | --------- | ------------------------------------------------ | --------------------------------------------- |
| EIP-7702  | `eip7702` | Any ERC-20 (USDT, DAI) + native ETH              | You want to accept any token, or sell for ETH |
| ERC-3009  | `exact`   | USDC and tokens with `transferWithAuthorization` | You only need USDC — simplest setup           |

Both mechanisms are gasless for the buyer. The facilitator pays gas and submits the on-chain transaction.

If you want to accept USDC **and** USDT, register both schemes — the seller lists both in its `accepts` array and the buyer picks one based on their token balance.

## Self-Hosted Facilitator vs Public Facilitator

Public facilitators like Coinbase CDP (`https://api.cdp.coinbase.com/platform/v2/x402`) support the `exact` scheme (ERC-3009/USDC) out of the box. If that's all you need, you don't need `@facilitator/server`.

**You need the self-hosted facilitator when:**

- You want to accept any ERC-20 token (USDT, DAI, custom tokens) via EIP-7702
- You want to accept native ETH payments
- You want persistent nonce tracking and settlement audit trails (database-backed)
- You want full control over the relayer, delegate contract, and verification logic

Read `references/facilitator-server.md` for setup instructions, CLI options, database configuration, and the full HTTP API reference.

## Deployed Delegate Contract

The EIP-7702 mechanism relies on a `Delegate.sol` smart contract that is deployed at the same address on all major EVM networks via CREATE2:

| Network   | Chain ID | Address                                      |
| --------- | -------- | -------------------------------------------- |
| Ethereum  | 1        | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| Optimism  | 10       | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| BNB Chain | 56       | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| Polygon   | 137      | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| Base      | 8453     | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| Arbitrum  | 42161    | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |
| Avalanche | 43114    | `0xD064939e706dC03699dB7Fe58bB0553afDF39fDd` |

For chains not listed here, deploy the contract yourself. Read `references/delegate-contract.md` for deployment instructions and contract details.

## Integration Checklist

When helping a developer integrate, walk through these steps in order:

### Step 1: Determine the scenario

- Are they building a **seller** (accepting payments for an API/resource)?
- Are they building a **buyer** (an agent that pays for resources)?
- Or both (agent-to-agent)?

### Step 2: Choose the payment mechanism

- USDC only → `exact` scheme (ERC-3009), can use public facilitator
- Any ERC-20 or ETH → `eip7702` scheme (EIP-7702), needs self-hosted facilitator
- Both → register both schemes

### Step 3: Verify the Delegate contract is deployed on their target chain

- Check the table above for known networks
- If not listed, guide them through deploying via Foundry (see `references/delegate-contract.md`)

### Step 4: Set up the facilitator (if using EIP-7702)

- Install and run `@facilitator/server` pointing to their chain RPC
- Fund the relayer wallet with ETH for gas
- Configure database for production (see `references/facilitator-server.md`)

### Step 5: Implement the seller side (if applicable)

- Add 402 response logic or use `@x402/express` middleware
- Define payment requirements (scheme, network, asset, amount, payTo)
- Wire verify + settle calls to the facilitator
- See `references/building-a-seller.md` for full code

### Step 6: Implement the buyer side (if applicable)

- Install `@x402/fetch` and `viem`
- Implement `SchemeNetworkClient` for EIP-7702 (or use `ExactEvmScheme` from `@x402/evm` for ERC-3009)
- Wrap fetch with `wrapFetchWithPaymentFromConfig`
- See `references/building-a-buyer.md` for full code

### Step 7: Test end-to-end

- Verify the buyer can receive a 402 response, sign payment, and get the resource
- Check the facilitator logs for verification and settlement details
- Verify on-chain that the token transfer completed

## Quick Reference: EIP-712 Domain

The `Delegate` contract uses this EIP-712 domain for signing payment intents:

```typescript
const domain = {
  name: "Delegate",
  version: "1.0",
  chainId: <chainId>,
  verifyingContract: <buyer's EOA address>,  // not the delegate contract!
};
```

The `verifyingContract` is the buyer's own address because under EIP-7702, the delegate code runs _as_ the buyer's account — so the EIP-712 domain must use the buyer's address as the verifying contract.

## Common Pitfalls

See `references/challenges-encountered.md`
