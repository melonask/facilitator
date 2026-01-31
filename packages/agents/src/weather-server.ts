import {
  createPublicClient,
  formatEther,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import tokenArtifact from "../test/MockERC20.json";

// Configuration
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:3000";
const PORT = process.env.PORT || 4000;
const CHAIN_ID = 31337;
const ANVIL_RPC = process.env.ANVIL_RPC || "http://127.0.0.1:8545";

// Seller Account (Anvil #2)
const SELLER_KEY =
  (process.env.SELLER_KEY as Hex) ||
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const sellerAccount = privateKeyToAccount(SELLER_KEY);

// Token
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS as Address;
if (!TOKEN_ADDRESS) throw new Error("TOKEN_ADDRESS env var required");

// Clients
const transport = http(ANVIL_RPC);
const publicClient = createPublicClient({ chain: foundry, transport });

console.log(`\n🤖 Agent 1 (Seller) running on port ${PORT}`);
console.log(`   Address: ${sellerAccount.address}`);
console.log(`   Token: ${TOKEN_ADDRESS}`);

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, PAYMENT-SIGNATURE",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- Endpoint: Balance Tracking ---
    if (url.pathname === "/balance") {
      const ethBalance = await publicClient.getBalance({
        address: sellerAccount.address,
      });
      const tokenBalance = (await publicClient.readContract({
        address: TOKEN_ADDRESS,
        abi: tokenArtifact.abi,
        functionName: "balanceOf",
        args: [sellerAccount.address],
      })) as bigint;

      return Response.json({
        address: sellerAccount.address,
        eth: formatEther(ethBalance),
        tokens: formatEther(tokenBalance),
      }, { headers: corsHeaders });
    }

    // --- Endpoint: Paid Resource ---
    if (url.pathname === "/weather") {
      const signatureHeader = req.headers.get("PAYMENT-SIGNATURE");

      if (!signatureHeader) {
        console.log(
          "   [Agent 1] 🛑 Incoming request without payment. Sending 402.",
        );
        return create402Response(corsHeaders);
      }

      try {
        const paymentPayload = JSON.parse(atob(signatureHeader));
        const requirements = createRequirements();

        // 1. Settle (Verification happens implicitly in settle)
        console.log("   [Agent 1] 💸 Requesting Settlement...");
        const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentPayload,
            paymentRequirements: requirements,
          }),
        });
        const settleData = (await settleRes.json()) as any;

        if (!settleData.success) {
          console.log(
            "   [Agent 1] ❌ Settlement Failed:",
            settleData.errorReason,
          );
          return new Response(
            JSON.stringify({ error: "Settlement Failed", details: settleData }),
            { status: 402, headers: corsHeaders },
          );
        }
        console.log(
          `   [Agent 1] 💰 Settlement Confirmed! Tx: ${settleData.transaction}`,
        );

        // 2. Deliver
        const weatherData = {
          location: "San Francisco",
          temperature: 72,
          condition: "Sunny",
          paid: true,
          txHash: settleData.transaction,
        };

        return new Response(JSON.stringify(weatherData), {
          headers: {
            "Content-Type": "application/json",
            "PAYMENT-RESPONSE": btoa(JSON.stringify(settleData)),
            ...corsHeaders
          },
        });
      } catch (e) {
        console.error("   [Agent 1] Server Error:", e);
        return new Response("Internal Error", { status: 500, headers: corsHeaders });
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
});

function createRequirements() {
  return {
    scheme: "eip7702",
    network: `eip155:${CHAIN_ID}`,
    asset: TOKEN_ADDRESS,
    amount: (10n ** 18n).toString(), // 1 Token
    payTo: sellerAccount.address,
    maxTimeoutSeconds: 300,
    extra: {},
  };
}

function create402Response(corsHeaders: any) {
  const requirements = createRequirements();
  const paymentRequired = {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: `http://localhost:${PORT}/weather`,
      description: "Weather Data",
      mimeType: "application/json",
    },
    accepts: [requirements],
    extensions: {
      // Bazaar Discovery Extension
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "GET",
          },
          output: {
            type: "json",
            example: {
              location: "San Francisco",
              temperature: 72,
              condition: "Sunny",
            },
          },
        },
        schema: {
          type: "object",
          properties: {
            input: {
              type: "object",
              properties: {
                type: { const: "http" },
                method: { const: "GET" },
              },
            },
          },
        },
      },
    },
  };

  return new Response(JSON.stringify(paymentRequired), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": btoa(JSON.stringify(paymentRequired)),
      ...corsHeaders
    },
  });
}
