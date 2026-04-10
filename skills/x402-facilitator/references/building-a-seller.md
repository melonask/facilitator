# Building a Seller (Resource Server)

A seller is an HTTP server that:

1. Returns `402 Payment Required` with payment requirements when no payment is attached
2. Verifies payments with the facilitator before serving the resource
3. Settles payments on-chain via the facilitator after verification

## The 402 Flow

```
Client → Seller: GET /resource
Seller → Client: 402 + PAYMENT-REQUIRED header (base64 JSON with payment requirements)
Client → Seller: GET /resource + PAYMENT-SIGNATURE header (base64 JSON with signed payment)
Seller → Facilitator: POST /verify { paymentPayload, paymentRequirements }
Facilitator → Seller: { isValid: true, payer: "0x..." }
Seller → Facilitator: POST /settle { paymentPayload, paymentRequirements }
Facilitator → Seller: { success: true, transaction: "0x...", payer: "0x..." }
Seller → Client: 200 + resource body + PAYMENT-RESPONSE header
```

## Payment Requirements Structure

When returning a 402, the seller specifies what payment it accepts:

```typescript
interface PaymentRequirements {
  scheme: "eip7702" | "exact"; // Payment mechanism
  network: string; // CAIP-2 format: "eip155:<chainId>"
  asset: string; // Token contract address or zero address for ETH
  amount: string; // Amount in smallest unit (wei)
  payTo: string; // Seller's address (where payment goes)
  maxTimeoutSeconds: number; // How long the payment authorization is valid
  extra: Record<string, unknown>; // Scheme-specific metadata
}
```

### EIP-7702 (USDT/Any ERC-20/ETH)

```typescript
const requirements = {
  scheme: "eip7702",
  network: "eip155:8453", // Base mainnet
  asset: USDT_ADDRESS, // ERC-20 token contract
  amount: (10n ** 18n).toString(), // 1 token (18 decimals)
  payTo: sellerAddress, // Your wallet address
  maxTimeoutSeconds: 300,
  extra: {},
};
```

For native ETH, use the zero address as `asset`: `0x0000000000000000000000000000000000000000`.

### ERC-3009 (USDC)

```typescript
const requirements = {
  scheme: "exact",
  network: "eip155:8453",
  asset: USDC_ADDRESS,
  amount: (10n ** 6n).toString(), // 1 USDC (6 decimals)
  payTo: sellerAddress,
  maxTimeoutSeconds: 300,
  extra: {
    name: "USD Coin", // EIP-712 domain name from the target token contract
    version: "2", // EIP-712 domain version from the target token contract
  },
};
```

The `extra.name` and `extra.version` are required for ERC-3009 — they define the EIP-712 domain used by the USDC contract. _Tip: You can usually find these by checking the `name()` and `version()` or querying `EIP712_DOMAIN_SEPARATOR()` on the ERC-20 contract itself._

## The 402 Response

Return a 402 with the payment requirements in both the response body and the `PAYMENT-REQUIRED` header:

```typescript
function create402Response() {
  const paymentRequired = {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: "https://api.example.com/weather",
      description: "Weather data",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "eip7702",
        network: "eip155:8453",
        asset: USDT_ADDRESS,
        amount: "1000000000000000000",
        payTo: sellerAddress,
        maxTimeoutSeconds: 300,
        extra: {},
      },
    ],
  };

  return new Response(JSON.stringify(paymentRequired), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": btoa(JSON.stringify(paymentRequired)),
    },
  });
}
```

The `accepts` array can include multiple options — a seller can accept both USDT (eip7702) and USDC (exact).

## Verifying a Payment

When a request comes in with a `PAYMENT-SIGNATURE` header:

```typescript
const signatureHeader = req.headers.get("PAYMENT-SIGNATURE");
if (!signatureHeader) return create402Response();

const paymentPayload = JSON.parse(atob(signatureHeader));
const requestBody = JSON.stringify({ paymentPayload, paymentRequirements });

// 1. Verify
const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: requestBody,
});
const verifyData = await verifyRes.json();

if (!verifyData.isValid) {
  return new Response("Payment verification failed", { status: 402 });
}
```

## Settling a Payment

After successful verification, settle on-chain:

```typescript
// 2. Settle
const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: requestBody,
});
const settleData = await settleRes.json();

if (!settleData.success) {
  return new Response("Settlement failed", { status: 402 });
}

// 3. Deliver the resource
const payload = { data: "your resource", txHash: settleData.transaction };
return new Response(JSON.stringify(payload), {
  headers: {
    "Content-Type": "application/json",
    "PAYMENT-RESPONSE": btoa(JSON.stringify(settleData)),
  },
});
```

## Using @x402/express Middleware

Instead of handling the 402 flow manually, you can use the official Express middleware:

```typescript
import { paymentMiddleware } from "@x402/express";

app.use(
  paymentMiddleware({
    "GET /weather": {
      accepts: [
        {
          scheme: "eip7702",
          price: "$0.01",
          network: "eip155:8453",
          payTo: "0xYourAddress",
        },
      ],
      description: "Weather data",
    },
  }),
);
```

Other framework integrations: `@x402/hono`, `@x402/next`, `@x402/paywall`. These use the Coinbase CDP facilitator by default. To use your self-hosted facilitator with these, set the `facilitator` option in the middleware config.
