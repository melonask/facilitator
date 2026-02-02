import { createPublicClient, formatEther, http, } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createRequire } from "node:module";
import { serve } from "./serve.js";
const require = createRequire(import.meta.url);
const tokenArtifact = require("../../contracts/out/ERC20Mock.sol/ERC20Mock.json");
// Configuration
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:3000";
const PORT = process.env.PORT || 4000;
const CHAIN_ID = 31337;
const ANVIL_RPC = process.env.ANVIL_RPC || "http://127.0.0.1:8545";
// Seller Account (Anvil #2)
const SELLER_KEY = process.env.SELLER_KEY ||
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const sellerAccount = privateKeyToAccount(SELLER_KEY);
// Token
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
if (!TOKEN_ADDRESS)
    throw new Error("TOKEN_ADDRESS env var required");
// Clients
const transport = http(ANVIL_RPC);
const publicClient = createPublicClient({ chain: foundry, transport });
console.log(`\nAgent 1 (Seller) running on port ${PORT}`);
console.log(`   Address: ${sellerAccount.address}`);
console.log(`   Token: ${TOKEN_ADDRESS}`);
serve(PORT, async (req) => {
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
        }));
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
            console.log("   [Agent 1] Incoming request without payment. Sending 402.");
            return create402Response(corsHeaders);
        }
        console.log("   [Agent 1] Incoming request with payment.");
        try {
            const paymentPayload = JSON.parse(atob(signatureHeader));
            const requirements = createRequirements();
            const requestBody = JSON.stringify({
                paymentPayload,
                paymentRequirements: requirements,
            });
            // 1. Verify
            console.log("   [Agent 1] Requesting Verification...");
            const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: requestBody,
            });
            const verifyData = (await verifyRes.json());
            if (!verifyData.isValid) {
                console.log("   [Agent 1] Verification Failed:", verifyData.invalidReason);
                return new Response(JSON.stringify({
                    error: "Verification Failed",
                    details: verifyData,
                }), { status: 402, headers: corsHeaders });
            }
            console.log(`   [Agent 1] Verification Passed. Payer: ${verifyData.payer}`);
            // 2. Settle
            console.log("   [Agent 1] Requesting Settlement...");
            const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: requestBody,
            });
            const settleData = (await settleRes.json());
            if (!settleData.success) {
                console.log("   [Agent 1] Settlement Failed:", settleData.errorReason);
                return new Response(JSON.stringify({ error: "Settlement Failed", details: settleData }), { status: 402, headers: corsHeaders });
            }
            console.log(`   [Agent 1] Settlement Confirmed! Tx: ${settleData.transaction}`);
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
                    ...corsHeaders,
                },
            });
        }
        catch (e) {
            console.error("   [Agent 1] Server Error:", e);
            return new Response("Internal Error", {
                status: 500,
                headers: corsHeaders,
            });
        }
    }
    return new Response("Not Found", { status: 404, headers: corsHeaders });
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
function create402Response(corsHeaders) {
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
            ...corsHeaders,
        },
    });
}
