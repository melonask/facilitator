import { createRequire } from "node:module";
import { createPublicClient, formatEther, http, } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { serve } from "./serve.js";
const require = createRequire(import.meta.url);
const tokenArtifact = require("../public/abi/ERC20Mock.sol/ERC20Mock.json");
const eip3009Artifact = require("../public/abi/EIP3009Mock.sol/EIP3009Mock.json");
// Configuration
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:3000";
const PORT = process.env.PORT || 4000;
const CHAIN_ID = 31337;
const ANVIL_RPC = process.env.ANVIL_RPC || "http://127.0.0.1:8545";
// Seller Account (Anvil #2)
const SELLER_KEY = process.env.SELLER_KEY ||
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const sellerAccount = privateKeyToAccount(SELLER_KEY);
// Tokens
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const USDC_ADDRESS = process.env.USDC_ADDRESS;
const USDC_NAME = process.env.USDC_NAME || "EIP3009Mock";
const USDC_VERSION = process.env.USDC_VERSION || "1";
if (!TOKEN_ADDRESS)
    throw new Error("TOKEN_ADDRESS env var required");
// Clients
const transport = http(ANVIL_RPC);
const publicClient = createPublicClient({ chain: foundry, transport });
console.log(`\nAgent 1 (Seller) running on port ${PORT}`);
console.log(`   Address: ${sellerAccount.address}`);
console.log(`   USDT: ${TOKEN_ADDRESS}`);
if (USDC_ADDRESS)
    console.log(`   USDC: ${USDC_ADDRESS}`);
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
        const tokenBalance = (await publicClient.readContract({
            address: TOKEN_ADDRESS,
            abi: tokenArtifact.abi,
            functionName: "balanceOf",
            args: [sellerAccount.address],
        }));
        let usdcBalance = 0n;
        if (USDC_ADDRESS) {
            usdcBalance = (await publicClient.readContract({
                address: USDC_ADDRESS,
                abi: eip3009Artifact.abi,
                functionName: "balanceOf",
                args: [sellerAccount.address],
            }));
        }
        return Response.json({
            address: sellerAccount.address,
            usdt: formatEther(tokenBalance),
            usdc: formatEther(usdcBalance),
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
            // Determine which scheme was used from the payload
            const scheme = paymentPayload.payload?.authorization?.from
                ? "exact"
                : "eip7702";
            const requirements = scheme === "exact"
                ? createUsdcRequirements()
                : createUsdtRequirements();
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
            const tokenUsed = scheme === "exact" ? "USDC (ERC-3009)" : "USDT (EIP-7702)";
            console.log(`   [Agent 1] Settlement Confirmed! Token: ${tokenUsed} Tx: ${settleData.transaction}`);
            // 3. Deliver
            const weatherData = {
                location: "San Francisco",
                temperature: 72,
                condition: "Sunny",
                paid: true,
                token: tokenUsed,
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
function createUsdtRequirements() {
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
function createUsdcRequirements() {
    return {
        scheme: "exact",
        network: `eip155:${CHAIN_ID}`,
        asset: USDC_ADDRESS,
        amount: (10n ** 18n).toString(), // 1 Token
        payTo: sellerAccount.address,
        maxTimeoutSeconds: 300,
        extra: {
            name: USDC_NAME,
            version: USDC_VERSION,
        },
    };
}
function create402Response(corsHeaders) {
    const accepts = [createUsdtRequirements()];
    if (USDC_ADDRESS) {
        accepts.push(createUsdcRequirements());
    }
    const paymentRequired = {
        x402Version: 2,
        error: "Payment required",
        resource: {
            url: `http://localhost:${PORT}/weather`,
            description: "Weather Data",
            mimeType: "application/json",
        },
        accepts,
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
