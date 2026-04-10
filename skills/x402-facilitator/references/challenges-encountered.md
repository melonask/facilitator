# LLM Knowledge Base: x402 & EIP-7702 Challenges Encountered

This document outlines critical gotchas, technical challenges, and resolutions when building with `x402`, EIP-7702 (Delegate contracts), Viem, and Anvil.

## 1. EIP-7702 & Cryptography (High Priority)

- **`verifyingContract` is the Buyer's EOA:** In the EIP-712 domain, `verifyingContract` MUST be the **buyer's EOA address**, NOT the Delegate contract address. Under EIP-7702, code runs in the context of the buyer's account. This is the #1 cause of `InvalidSignature` errors.
- **No ERC-20 `approve()` Needed:** The Delegate contract executes `transfer` directly from the buyer's account context. It does not use `transferFrom`.
- **Viem `signAuthorization` Version Discrepancies:** Viem versions differ in returned field names. Always map safely:
  ```javascript
  contractAddress: authorization.contractAddress ?? authorization.address,
  yParity: authorization.yParity ?? (authorization.v === 27n ? 0 : 1)
  ```
- **ETH Payments (`EthPaymentIntent`):** For native ETH, use `asset: 0x00...000`. The EIP-712 struct is `EthPaymentIntent` (omits the `token` field entirely, but retains `amount`, `to`, `nonce`, and `deadline`).
- **Testing Expiration:** Mutating an intent's `deadline` _after_ signing breaks recovery, resulting in `InvalidSignature` (not an `Expired` error).

## 2. Infrastructure & Testing (Anvil / Facilitator)

- **Anvil Requires Prague:** You **MUST** start Anvil with `anvil --hardfork prague`. Otherwise, EIP-7702 Type 4 transactions fail silently and delegation code does not persist.
- **Delegate Address Mismatch on Anvil:** The standard CREATE2 factory (`0x4e59...`) is not pre-deployed on fresh Anvil instances. Deploying it manually results in a different Delegate address than mainnet. **Fix:** Pass `--delegate-address <LOCAL_ADDRESS>` to the facilitator.
- **Facilitator State Desync (ERC-3009):** Pre-simulations (`eth_call`) fail across multiple test runs due to stale nonce tracking in the in-memory facilitator. **Fix:** Restart the facilitator between tests, or use `--db ./facilitator.db` for persistent SQLite tracking.
- **Relayer Gas:** The self-hosted facilitator's relayer pays settlement gas. Check the `/info` endpoint to ensure it has ETH.
- **Forge-std Name Collision:** Do not use `CREATE2_FACTORY` as a constant name in Foundry deployment scripts; it collides with `forge-std/Base.sol`. Use `CREATE2_DEPLOYER` instead.

## 3. Integration & Express.js

- **Multi-Token Fallback (`InsufficientBalance`):** If a seller returns multiple supported tokens in the `accepts` array (e.g., USDC, USDT, ETH), `@x402/fetch` checks the _first_ EIP-7702 match. If the buyer is paying in ETH, they fail the initial USDT balance check. **Fix:** Add a `?token=eth` query parameter to the 402 endpoint to filter the `accepts` array to the exact token the client intends to use.
- **Web `Response` in Express:** Do not return Web API `Response` objects in Express `create402Response()` handlers. Calling `.json()` on them throws `SyntaxError: Unexpected token 'o'`. **Fix:** Return plain JSON objects, use `res.status(402).json(payload)`, and manually set `res.setHeader('PAYMENT-REQUIRED', ...)`.
- **ERC-3009 Extra Fields:** The `exact` scheme strictly requires `extra.name` and `extra.version` to match the target USDC contract's EIP-712 domain.
- **@x402 Subpath Imports:** Omit `.js` file extensions for `@x402/evm` subpath imports. Use exact subpath matching: `import { ExactEvmScheme } from "@x402/evm/exact/client"`.
