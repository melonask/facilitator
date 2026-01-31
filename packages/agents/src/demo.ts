import { spawn } from "child_process";
import path from "node:path";
import fs from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

// Import Artifacts (Relative to this file's execution location)
// We assume this script is run from packages/agents
import delegateArtifact from "../test/Delegate.json";
import tokenArtifact from "../test/MockERC20.json";

const ANVIL_PORT = 8545;
const FACILITATOR_PORT = 3000;
const AGENT1_PORT = 4000;
const AGENT2_PORT = 4001;

// Keys
const DEPLOYER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RELAYER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const SELLER_KEY =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const BUYER_KEY =
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";

async function main() {
  console.log("=================================================");
  console.log("   x402 EIP-7702 Agent Economy Demo Orchestrator");
  console.log("=================================================");

  // --- Web Mode State ---
  let isWebMode = false;
  const logClients: Set<any> = new Set();
  
  function broadcastLog(source: string, message: string) {
    // Only buffer logs if web mode hasn't started, or stream if it has?
    // For now, let's just stream if connected.
    
    // Filter out empty lines or raw bytes if needed
    if (!message || !message.trim()) return;

    const data = JSON.stringify({ source, message });
    for (const controller of logClients) {
      try {
        controller.enqueue(`data: ${data}\n\n`);
      } catch (e) {
        logClients.delete(controller);
      }
    }
  }

  function startWebServer() {
    const WEB_PORT = 8080;
    const publicDir = path.resolve(import.meta.dir, "../public");

    Bun.serve({
      port: WEB_PORT,
      async fetch(req) {
        const url = new URL(req.url);

        // SSE Endpoint
        if (url.pathname === "/logs") {
          return new Response(new ReadableStream({
            start(controller) {
              logClients.add(controller);
            },
            cancel(controller) {
              logClients.delete(controller);
            },
          }), {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
            },
          });
        }

        // Static Files
        let filePath = path.join(publicDir, url.pathname === "/" ? "index.html" : url.pathname);
        
        // Safety check to prevent escaping public dir
        if (!filePath.startsWith(publicDir)) {
           return new Response("Forbidden", { status: 403 });
        }

        try {
            const file = Bun.file(filePath);
            if (await file.exists()) {
                return new Response(file);
            }
            return new Response("Not Found", { status: 404 });
        } catch(e) {
            return new Response("Error", { status: 500 });
        }
      },
    });

    console.log(`\n=================================================\n`);
    console.log(`   🎨 Web Visualizer Ready at http://localhost:${WEB_PORT}`);
    console.log(`=================================================
`);
    console.log(`   (Keep this terminal open to run the backend agents)`);
    
    // Attempt to open browser (Mac specific command as requested by user environment)
    spawn("open", [`http://localhost:${WEB_PORT}`]);
  }

  // 1. Start Anvil
  console.log("1. Starting Anvil...");
  const anvil = spawn("anvil", ["--port", String(ANVIL_PORT)], {
    stdio: "ignore",
  });

  // Cleanup hook
  process.on("SIGINT", () => {
    anvil.kill();
    process.exit();
  });

  await new Promise((r) => setTimeout(r, 2000));

  // 2. Deploy & Fund
  console.log("2. Deploying Contracts & Funding Accounts...");
  const transport = http(`http://127.0.0.1:${ANVIL_PORT}`);
  const publicClient = createPublicClient({ chain: foundry, transport });
  const walletClient = createWalletClient({ chain: foundry, transport });

  const deployer = privateKeyToAccount(DEPLOYER_KEY);
  const relayer = privateKeyToAccount(RELAYER_KEY);
  const buyer = privateKeyToAccount(BUYER_KEY);

  // Deploy Delegate
  const deployDelegateHash = await walletClient.deployContract({
    account: deployer,
    abi: delegateArtifact.abi,
    bytecode: delegateArtifact.bytecode.object as Hex,
  });
  const delegateAddress = (
    await publicClient.waitForTransactionReceipt({ hash: deployDelegateHash })
  ).contractAddress!;
  console.log(`   Delegate Contract: ${delegateAddress}`);

  // Deploy Token
  const deployTokenHash = await walletClient.deployContract({
    account: deployer,
    abi: tokenArtifact.abi,
    bytecode: tokenArtifact.bytecode.object as Hex,
  });
  const tokenAddress = (
    await publicClient.waitForTransactionReceipt({ hash: deployTokenHash })
  ).contractAddress!;
  console.log(`   Token Contract:    ${tokenAddress}`);

  // Mint to Buyer (1000 Tokens)
  await walletClient.writeContract({
    account: deployer,
    address: tokenAddress,
    abi: tokenArtifact.abi,
    functionName: "mint",
    args: [buyer.address, parseEther("1000")],
  });
  console.log(`   Funded Buyer with 1000 Tokens`);

  // Fund Relayer (10 ETH)
  await walletClient.sendTransaction({
    account: deployer,
    to: relayer.address,
    value: parseEther("10"),
  });
  console.log(`   Funded Relayer with 10 ETH`);

  // 3. Start Facilitator
  console.log("3. Starting Facilitator Server...");
  const facilitator = spawn(
    "bun",
    ["run", path.resolve(import.meta.dir, "../../server/src/index.ts")],
    {
      env: {
        ...process.env,
        PORT: String(FACILITATOR_PORT),
        RELAYER_PRIVATE_KEY: RELAYER_KEY,
        DELEGATE_ADDRESS: delegateAddress,
        [`RPC_URL_${foundry.id}`]: `http://127.0.0.1:${ANVIL_PORT}`,
      },
      stdio: "inherit",
    },
  );

  await new Promise((r) => setTimeout(r, 1000));

  // 4. Start Agent 1 (Seller)
  console.log("4. Starting Agent 1 (Weather Seller)...");
  const agent1 = spawn("bun", ["run", path.resolve(import.meta.dir, "weather-server.ts")], {
    env: {
      ...process.env,
      PORT: String(AGENT1_PORT),
      FACILITATOR_URL: `http://localhost:${FACILITATOR_PORT}`,
      SELLER_KEY: SELLER_KEY,
      TOKEN_ADDRESS: tokenAddress,
      ANVIL_RPC: `http://127.0.0.1:${ANVIL_PORT}`,
    },
    stdio: "pipe", // CHANGED to pipe to capture output
  });

  await new Promise((r) => setTimeout(r, 1000));

  // 5. Start Agent 2 (Buyer)
  console.log("5. Starting Agent 2 (Weather Buyer)...");
  const agent2 = spawn("bun", ["run", path.resolve(import.meta.dir, "buyer-server.ts")], {
    env: {
      ...process.env,
      PORT: String(AGENT2_PORT),
      WEATHER_AGENT_URL: `http://localhost:${AGENT1_PORT}/weather`,
      BUYER_KEY: BUYER_KEY,
      DELEGATE_ADDRESS: delegateAddress,
      TOKEN_ADDRESS: tokenAddress,
      ANVIL_RPC: `http://127.0.0.1:${ANVIL_PORT}`,
    },
    stdio: "pipe", // We want to capture output
  });

  // Monitor Agent 2 output
  agent2.stdout.on("data", async (data) => {
    const output = data.toString();
    process.stdout.write(output); // Passthrough to console
    broadcastLog("Agent 2", output);

    if (output.includes("Data Received")) {
      console.log("\n✨ Demo Successfully Completed!");

      // Check Bazaar Catalog
      console.log("\n🔍 Checking Bazaar Catalog...");
      try {
        const res = await fetch(
          `http://localhost:${FACILITATOR_PORT}/discovery/resources`,
        );
        const catalog = await res.json();
        console.log(JSON.stringify(catalog, null, 2));
      } catch (e) {
        console.error("Failed to query catalog:", e);
      }

      // Instead of shutting down, switch to Web Mode
      if (!isWebMode) {
        isWebMode = true;
        clearTimeout(timeout); // Disable timeout
        console.log("\n🌐 Switching to Web Visualizer Mode...");
        startWebServer();
      }
    }
  });

  agent2.stderr.on("data", (data) => {
    process.stderr.write(data);
    broadcastLog("Agent 2", data.toString());
  });

  // Monitor Agent 1 output for logs too
  agent1.stdout.on("data", (data) => {
    process.stdout.write(data); // Also print Agent 1 logs to console now that we pipe it
    broadcastLog("Agent 1", data.toString());
  });
  agent1.stderr.on("data", (data) => {
    process.stderr.write(data);
    broadcastLog("Agent 1", data.toString());
  });


  console.log("\n✅ All systems go! Waiting for autonomous purchase...\n");

  // Timeout (Only applies to the initial run)
  const timeout = setTimeout(() => {
    if (!isWebMode) {
      console.error("\n❌ Demo timed out!");
      cleanup();
    }
  }, 60000);

  function cleanup() {
    clearTimeout(timeout);
    agent2.kill();
    agent1.kill();
    facilitator.kill();
    anvil.kill();
    process.exit(0);
  }
}

main().catch(console.error);