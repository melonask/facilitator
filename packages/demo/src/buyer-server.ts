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
import { serve } from "./serve.js";

const require = createRequire(import.meta.url);
const tokenArtifact = require("../../contracts/out/ERC20Mock.sol/ERC20Mock.json");

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

// Initialize wrapped fetch with payment config
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [
    {
      network: "eip155:31337", // Anvil
      client: new Eip7702Scheme(buyerAccount, CHAIN_ID, DELEGATE_ADDRESS),
    },
  ],
});

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
    const ethBalance = await publicClient.getBalance({
      address: buyerAccount.address,
    });
    const tokenBalance = (await publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: tokenArtifact.abi,
      functionName: "balanceOf",
      args: [buyerAccount.address],
    })) as bigint;

    return Response.json(
      {
        address: buyerAccount.address,
        eth: formatEther(ethBalance),
        tokens: formatEther(tokenBalance),
      },
      { headers: corsHeaders },
    );
  }

  // --- Endpoint: Manual Trigger ---
  if (url.pathname === "/buy") {
    // Trigger asynchronously
    buyWeather();
    return new Response("Purchase initiated check console", {
      headers: corsHeaders,
    });
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
});

async function buyWeather() {
  try {
    console.log("   [Agent 2] Contacting Agent 1 for Weather...");

    const res = await fetchWithPayment(WEATHER_AGENT_URL);
    const data = await res.json();
    console.log("   [Agent 2] Data Received:", data);

    const paymentResponse = res.headers.get("PAYMENT-RESPONSE");
    if (paymentResponse) {
      const decoded = decodePaymentResponseHeader(paymentResponse);
      console.log(`   [Agent 2] Tx Hash: ${decoded.transaction}`);
    }
  } catch (e) {
    console.error("   [Agent 2] Error:", e);
  }
}
