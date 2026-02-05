import {
  decodePaymentResponseHeader,
  wrapFetchWithPaymentFromConfig,
} from "@x402/fetch";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createRequire } from "node:module";
import { Eip7702Scheme } from "./eip7702-client.js";
import { Eip3009Scheme } from "./eip3009-client.js";
import { serve } from "./serve.js";

const require = createRequire(import.meta.url);
const tokenArtifact = require("../public/abi/ERC20Mock.sol/ERC20Mock.json");
const eip3009Artifact = require("../public/abi/EIP3009Mock.sol/EIP3009Mock.json");

// Configuration
const PORT = process.env.PORT || 4001;
const WEATHER_AGENT_URL =
  process.env.WEATHER_AGENT_URL || "http://localhost:4000/weather";
const CHAIN_ID = 31337;
const ANVIL_RPC = process.env.ANVIL_RPC || "http://127.0.0.1:8545";

// Buyer Account (Anvil #3)
const BUYER_KEY =
  (process.env.BUYER_KEY as Hex) ||
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const buyerAccount = privateKeyToAccount(BUYER_KEY);

// Contract Addresses
const DELEGATE_ADDRESS = process.env.DELEGATE_ADDRESS as Address;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS as Address;
const USDC_ADDRESS = process.env.USDC_ADDRESS as Address;
if (!DELEGATE_ADDRESS || !TOKEN_ADDRESS)
  throw new Error("Addresses env vars required");

// Clients
const transport = http(ANVIL_RPC);
const walletClient = createWalletClient({
  chain: foundry,
  transport,
  account: buyerAccount,
});
const publicClient = createPublicClient({ chain: foundry, transport });

console.log(`
Agent 2 (Buyer) running on port ${PORT}`);
console.log(`   Address: ${buyerAccount.address}`);

// Initialize wrapped fetch for EIP-7702 (USDT)
const fetchWithUsdt = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [
    {
      network: "eip155:31337",
      client: new Eip7702Scheme(buyerAccount, CHAIN_ID, DELEGATE_ADDRESS),
    },
  ],
});

// Initialize wrapped fetch for ERC-3009 (USDC)
const fetchWithUsdc = USDC_ADDRESS
  ? wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [
        {
          network: "eip155:31337",
          client: new Eip3009Scheme(buyerAccount, CHAIN_ID),
        },
      ],
    })
  : null;

// Track purchase count for alternating
let purchaseCount = 0;

// Start Server
serve(PORT, async (req) => {
  const url = new URL(req.url);

  // CORS Headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
      args: [buyerAccount.address],
    })) as bigint;

    let usdcBalance = 0n;
    if (USDC_ADDRESS) {
      usdcBalance = (await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: eip3009Artifact.abi,
        functionName: "balanceOf",
        args: [buyerAccount.address],
      })) as bigint;
    }

    return Response.json(
      {
        address: buyerAccount.address,
        usdt: formatEther(tokenBalance),
        usdc: formatEther(usdcBalance),
      },
      { headers: corsHeaders },
    );
  }

  // --- Endpoint: Manual Trigger ---
  if (url.pathname === "/buy") {
    const tokenParam = url.searchParams.get("token");
    const useUsdc =
      tokenParam === "usdc"
        ? true
        : tokenParam === "usdt"
          ? false
          : purchaseCount % 2 === 1; // alternate by default

    buyWeather(useUsdc);
    return new Response("Purchase initiated check console", {
      headers: corsHeaders,
    });
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
});

async function buyWeather(useUsdc: boolean) {
  try {
    purchaseCount++;

    if (useUsdc && fetchWithUsdc) {
      console.log("   [Agent 2] Paying with USDC (ERC-3009)");
      console.log("   [Agent 2] Contacting Agent 1 for Weather...");

      const res = await fetchWithUsdc(WEATHER_AGENT_URL);
      const data = await res.json();
      console.log("   [Agent 2] Data Received:", data);

      const paymentResponse = res.headers.get("PAYMENT-RESPONSE");
      if (paymentResponse) {
        const decoded = decodePaymentResponseHeader(paymentResponse);
        console.log(`   [Agent 2] Tx Hash: ${decoded.transaction}`);
      }
    } else {
      console.log("   [Agent 2] Paying with USDT (EIP-7702)");
      console.log("   [Agent 2] Contacting Agent 1 for Weather...");

      const res = await fetchWithUsdt(WEATHER_AGENT_URL);
      const data = await res.json();
      console.log("   [Agent 2] Data Received:", data);

      const paymentResponse = res.headers.get("PAYMENT-RESPONSE");
      if (paymentResponse) {
        const decoded = decodePaymentResponseHeader(paymentResponse);
        console.log(`   [Agent 2] Tx Hash: ${decoded.transaction}`);
      }
    }
  } catch (e) {
    console.error("   [Agent 2] Error:", e);
  }
}
