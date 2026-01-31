import { parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Configuration
const WEATHER_AGENT_URL =
  process.env.WEATHER_AGENT_URL || "http://localhost:4000/weather";
const CHAIN_ID = 31337;

// Wallet for Consumer Agent (Buyer)
// Using Anvil Account #3: 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
const BUYER_KEY =
  (process.env.BUYER_KEY as Hex) ||
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const buyerAccount = privateKeyToAccount(BUYER_KEY);

// Delegate Contract (From env)
const DELEGATE_ADDRESS = process.env.DELEGATE_ADDRESS as Address;
if (!DELEGATE_ADDRESS) throw new Error("DELEGATE_ADDRESS env var required");

console.log(`🤖 Consumer Agent (Buyer) started`);
console.log(`💰 Wallet: ${buyerAccount.address}`);

async function run() {
  try {
    console.log("📡 Requesting Weather Data...");

    // 1. Initial Request
    const res = await fetch(WEATHER_AGENT_URL);

    if (res.status === 200) {
      console.log("✅ Success (No payment needed?):", await res.json());
      return;
    }

    if (res.status === 402) {
      console.log("🛑 402 Payment Required");

      // 2. Parse Requirements
      const paymentRequiredHeader = res.headers.get("PAYMENT-REQUIRED");
      if (!paymentRequiredHeader)
        throw new Error("Missing PAYMENT-REQUIRED header");

      const paymentRequired = JSON.parse(atob(paymentRequiredHeader));
      // Find EIP-7702 scheme
      const requirement = paymentRequired.accepts.find(
        (r: any) => r.scheme === "eip7702",
      );
      if (!requirement) throw new Error("Agent does not support EIP-7702");

      console.log(
        `📝 Requirement: Pay ${parseEther(requirement.amount).toString()} wei to ${requirement.payTo}`,
      );

      // 3. Prepare Payment
      await new Promise((r) => setTimeout(r, 1)); // Ensure unique timestamp
      const intent = {
        token: requirement.asset,
        amount: requirement.amount,
        to: requirement.payTo,
        nonce: Date.now().toString(), // Simple nonce
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour
      };

      // 4. Sign EIP-712 Intent
      const signature = await buyerAccount.signTypedData({
        domain: {
          name: "Delegate",
          version: "1.0",
          chainId: CHAIN_ID,
          verifyingContract: buyerAccount.address, // EIP-7702: Code delegates to EOA
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

      // 5. Sign EIP-7702 Authorization
      const authorization = await buyerAccount.signAuthorization({
        contractAddress: DELEGATE_ADDRESS,
        chainId: CHAIN_ID,
        nonce: 0, // EOA nonce (Using 0 for simplicity, ideally fetch from chain)
      });

      // 6. Construct Header Payload
      const payload = {
        x402Version: 2,
        resource: paymentRequired.resource,
        accepted: requirement,
        payload: {
          authorization: {
            contractAddress: authorization.address, // Correct field
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

      // 7. Retry Request with Payment
      console.log("🚀 Sending Paid Request...");
      const paidRes = await fetch(WEATHER_AGENT_URL, {
        headers: {
          "PAYMENT-SIGNATURE": paymentHeader,
        },
      });

      if (paidRes.status === 200) {
        const data = await paidRes.json();
        console.log("🎉 Success! Received Weather Data:");
        console.log(data);

        const settleHeader = paidRes.headers.get("PAYMENT-RESPONSE");
        if (settleHeader) {
          const settlement = JSON.parse(atob(settleHeader));
          console.log(`🔗 Transaction Hash: ${settlement.transaction}`);
        }
      } else {
        console.log(`❌ Failed with status ${paidRes.status}`);
        console.log(await paidRes.text());
      }
    } else {
      console.log("Unexpected status:", res.status);
    }
  } catch (e) {
    console.error("Client Error:", e);
    process.exit(1);
  }
}

run();
