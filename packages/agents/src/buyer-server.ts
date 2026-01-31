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
import tokenArtifact from "../test/MockERC20.json";

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
🤖 Agent 2 (Buyer) running on port ${PORT}`);
console.log(`   Address: ${buyerAccount.address}`);

// Start Server
Bun.serve({
  port: PORT,
  async fetch(req) {
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

      return Response.json({
        address: buyerAccount.address,
        eth: formatEther(ethBalance),
        tokens: formatEther(tokenBalance),
      }, { headers: corsHeaders });
    }

    // --- Endpoint: Manual Trigger ---
    if (url.pathname === "/buy") {
      // Trigger asynchronously
      buyWeather();
      return new Response("Purchase initiated check console", { headers: corsHeaders });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
});

// Auto-start purchase logic after a brief delay
setTimeout(buyWeather, 3000);

async function buyWeather() {
  try {
    console.log("   [Agent 2] 📡 Contacting Agent 1 for Weather...");

    // 1. Initial Request
    const res = await fetch(WEATHER_AGENT_URL);

    if (res.status === 200) {
      console.log("   [Agent 2] ✅ Success (Free?):", await res.json());
      return;
    }

    if (res.status === 402) {
      console.log("   [Agent 2] 🛑 Received 402. Analyzing costs...");

      const paymentRequiredHeader = res.headers.get("PAYMENT-REQUIRED");
      if (!paymentRequiredHeader)
        throw new Error("Missing PAYMENT-REQUIRED header");

      const paymentRequired = JSON.parse(atob(paymentRequiredHeader));
      const requirement = paymentRequired.accepts.find(
        (r: any) => r.scheme === "eip7702",
      );
      if (!requirement) throw new Error("Agent does not support EIP-7702");

      console.log(
        `   [Agent 2] 📝 Price: ${formatEther(BigInt(requirement.amount))} Tokens`,
      );
      console.log(`   [Agent 2] ✍️  Signing EIP-712 Intent & EIP-7702 Auth...`);

      // Prepare Intent
      const intent = {
        token: requirement.asset,
        amount: requirement.amount,
        to: requirement.payTo,
        nonce: Date.now().toString(),
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      };

      // Sign EIP-712
      const signature = await buyerAccount.signTypedData({
        domain: {
          name: "Delegate",
          version: "1.0",
          chainId: CHAIN_ID,
          verifyingContract: buyerAccount.address,
        },
        types: {
          PaymentIntent: [
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "to", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "PaymentIntent",
        message: {
          token: intent.token,
          amount: BigInt(intent.amount),
          to: intent.to,
          nonce: BigInt(intent.nonce),
          deadline: intent.deadline,
        },
      });

      // Sign EIP-7702
      const authorization = await buyerAccount.signAuthorization({
        contractAddress: DELEGATE_ADDRESS,
        chainId: CHAIN_ID,
        nonce: 0, // In real app, query nonce
      });

      // Construct Payload
      const payload = {
        x402Version: 2,
        resource: paymentRequired.resource,
        accepted: requirement,
        extensions: paymentRequired.extensions, // Pass through extensions for indexing
        payload: {
          authorization: {
            contractAddress: authorization.address,
            chainId: authorization.chainId,
            nonce: authorization.nonce,
            r: authorization.r,
            s: authorization.s,
            yParity: authorization.yParity,
          },
          intent: {
            ...intent,
            deadline: intent.deadline.toString(),
          },
          signature,
        },
      };

      const paymentHeader = btoa(JSON.stringify(payload));

      // Retry
      console.log("   [Agent 2] 🚀 Sending Signed Request...");
      const paidRes = await fetch(WEATHER_AGENT_URL, {
        headers: { "PAYMENT-SIGNATURE": paymentHeader },
      });

      if (paidRes.status === 200) {
        const data = await paidRes.json();
        console.log("   [Agent 2] 🎉 Data Received:", data);

        const settleHeader = paidRes.headers.get("PAYMENT-RESPONSE");
        if (settleHeader) {
          const settlement = JSON.parse(atob(settleHeader));
          console.log(`   [Agent 2] 🔗 Tx Hash: ${settlement.transaction}`);
        }
      } else {
        console.log(
          `   [Agent 2] ❌ Failed: ${paidRes.status} - ${await paidRes.text()}`,
        );
      }
    }
  } catch (e) {
    console.error("   [Agent 2] Error:", e);
  }
}
