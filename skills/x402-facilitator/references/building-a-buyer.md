# Building a Buyer (Payment Client)

A buyer is an HTTP client that:

1. Sends a normal request to a paid resource
2. Receives a 402 response with payment requirements
3. Signs a payment authorization (gasless, off-chain)
4. Re-sends the request with the payment attached
5. Receives the resource

> **Note on ERC-20 Approvals:** The buyer does **not** need to call `approve()` on the ERC-20 token contract. Because EIP-7702 delegates code to the buyer's own account, the Delegate contract calls `transfer` natively from the buyer's context.

## Using @x402/fetch

The simplest approach — wrap your `fetch` with automatic payment handling:

```typescript
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount("0x..." as `0x${string}`);
```

### EIP-7702 Client (USDT / Any ERC-20 / ETH)

The buyer needs to implement `SchemeNetworkClient` to sign EIP-712 intents and EIP-7702 authorizations:

```typescript
import type {
  SchemeNetworkClient,
  PaymentPayload,
  PaymentRequirements,
} from "@x402/fetch";
import type { Address, PrivateKeyAccount, TypedDataDomain } from "viem";

class Eip7702Scheme implements SchemeNetworkClient {
  readonly scheme = "eip7702";

  constructor(
    private account: PrivateKeyAccount,
    private chainId: number,
    private delegateAddress: Address,
  ) {}

  async createPaymentPayload(
    _version: number,
    requirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    // Create the payment intent.
    // In production, use a secure, unique nonce (e.g., UUID or DB counter)
    const intent = {
      token: requirements.asset as Address,
      amount: BigInt(requirements.amount),
      to: requirements.payTo as Address,
      nonce: BigInt(Date.now()),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    };

    const domain: TypedDataDomain = {
      name: "Delegate",
      version: "1.0",
      chainId: this.chainId,
      verifyingContract: this.account.address, // Must be the buyer's address!
    };

    const types = {
      PaymentIntent: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "to", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    } as const;

    // 1. Sign EIP-712 Intent
    const signature = await this.account.signTypedData({
      domain,
      types,
      primaryType: "PaymentIntent",
      message: intent,
    });

    // 2. Sign EIP-7702 Authorization
    // Note: Because a relayer submits this, do NOT set `executor: "self"`
    const authorization = await this.account.signAuthorization({
      contractAddress: this.delegateAddress,
      chainId: this.chainId,
      nonce: 0, // This is the authorization nonce (often 0 for first-time use)
    });

    return {
      x402Version: 2,
      payload: {
        authorization: {
          // Safely map viem differences across versions (address vs contractAddress, v vs yParity)
          contractAddress:
            (authorization as any).contractAddress ??
            (authorization as any).address,
          chainId: authorization.chainId,
          nonce: authorization.nonce,
          r: authorization.r,
          s: authorization.s,
          yParity:
            authorization.yParity ?? ((authorization as any).v === 27n ? 0 : 1),
        },
        intent: {
          ...intent,
          amount: intent.amount.toString(),
          nonce: intent.nonce.toString(),
          deadline: intent.deadline.toString(),
        },
        signature,
      },
    };
  }
}
```

For native ETH payments, use the `EthPaymentIntent` type instead (no `token` field):

```typescript
const types = {
  EthPaymentIntent: [
    { name: "amount", type: "uint256" },
    { name: "to", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
```

### ERC-3009 Client (USDC)

```typescript
import { ExactEvmScheme } from "@x402/evm/exact/client";

const evmSigner = {
  ...publicClient,
  ...walletClient,
  address: account.address,
};
const client = new ExactEvmScheme(evmSigner);
```

### Wiring It Together

```typescript
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [
    {
      network: "eip155:8453",
      client: new Eip7702Scheme(account, 8453, DELEGATE_ADDRESS),
    },
  ],
});

// Now use fetchWithPayment just like fetch — 402 handling is automatic
const response = await fetchWithPayment("https://api.example.com/weather");
const data = await response.json();
```

For multi-scheme support (both USDT and USDC), register both schemes:

```typescript
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [
    {
      network: "eip155:8453",
      client: new Eip7702Scheme(account, 8453, DELEGATE_ADDRESS),
    },
    {
      network: "eip155:8453",
      client: new ExactEvmScheme(evmSigner),
    },
  ],
});
```

## The @x402/fetch Package

Install: `npm install @x402/fetch viem`

Key exports:

- `wrapFetchWithPaymentFromConfig(fetch, config)` — Wraps any `fetch` implementation with automatic 402 payment handling
- `x402Client` — Low-level client for manual payment creation
- `decodePaymentResponseHeader(header)` — Decodes the `PAYMENT-RESPONSE` header from the seller's response
