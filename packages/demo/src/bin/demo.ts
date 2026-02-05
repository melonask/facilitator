#!/usr/bin/env node
import { spawn } from "child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { serve } from "../serve.js";

const require = createRequire(import.meta.url);

// Import Artifacts
const delegateArtifact = require("../../public/abi/Delegate.sol/Delegate.json");
const tokenArtifact = require("../../public/abi/ERC20Mock.sol/ERC20Mock.json");
const eip3009Artifact = require("../../public/abi/EIP3009Mock.sol/EIP3009Mock.json");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ANVIL_PORT = 8545;
const FACILITATOR_PORT = 8080;
const BUYER_PORT = 4000;
const SELLER_PORT = 4001;
const WEB_PORT = 3030;

// Keys
const DEPLOYER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Anvil #0
const RELAYER_KEY = generatePrivateKey();
const SELLER_KEY = generatePrivateKey();
const BUYER_KEY = generatePrivateKey();

// ---- Pretty CLI helpers ----

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";

function banner() {
  console.log(`
${DIM}──────────────────────────────────────────────${RESET}
  ${BOLD}x402${RESET} ${DIM}//${RESET} Multi-Mechanism Agent Economy Demo
${DIM}──────────────────────────────────────────────${RESET}`);
}

function topology(delegate: string, token: string) {
  const d = delegate.slice(0, 6) + ".." + delegate.slice(-4);
  const t = token.slice(0, 6) + ".." + token.slice(-4);
  console.log(`
${DIM}  ┌─────────────┐          ┌─────────────┐${RESET}
${DIM}  │${RESET} ${BLUE}BUYER${RESET}       ${DIM}│${RESET}          ${DIM}│${RESET} ${GREEN}SELLER${RESET}      ${DIM}│${RESET}
${DIM}  │${RESET}  :${BUYER_PORT}      ${DIM}│ ◄─x402─► │${RESET}  :${SELLER_PORT}      ${DIM}│${RESET}
${DIM}  └─────────────┘          └──────┬──────┘${RESET}
${DIM}              ┌──────────────┐    │${RESET}
${DIM}              │${RESET} ${YELLOW}FACILITATOR${RESET}  ${DIM}│◄───┘${RESET}
${DIM}              │${RESET}  :${FACILITATOR_PORT}       ${DIM}│${RESET}
${DIM}              └──────┬───────┘${RESET}
${DIM}                     │${RESET}
${DIM}              ┌──────┴───────┐${RESET}
${DIM}              │${RESET} ${MAGENTA}ANVIL${RESET}  :${ANVIL_PORT} ${DIM}│${RESET}
${DIM}              └──────────────┘${RESET}
${DIM}  delegate ${CYAN}${d}${RESET}  ${DIM}token ${CYAN}${t}${RESET}`);
}

function step(n: number, label: string) {
  console.log(`
  ${DIM}[${n}]${RESET} ${label}`);
}

function detail(label: string, value: string) {
  console.log(`      ${DIM}${label}${RESET} ${value}`);
}

function ok(msg: string) {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}

function getMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

async function main() {
  banner();

  // --- Web Mode State ---
  const logClients: Set<ReadableStreamDefaultController> = new Set();

  function broadcastLog(source: string, message: string) {
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

  // 1. Start Anvil
  step(1, "Starting Anvil");
  const anvil = spawn("anvil", ["--port", String(ANVIL_PORT)], {
    stdio: "ignore",
  });
  process.on("SIGINT", () => {
    anvil.kill();
    process.exit();
  });
  await new Promise((r) => setTimeout(r, 2000));
  ok(`Anvil on :${ANVIL_PORT}`);

  // 2. Deploy & Fund
  step(2, "Deploy contracts & fund accounts");
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

  // Deploy USDT (Generic Mock)
  const deployUsdtHash = await walletClient.deployContract({
    account: deployer,
    abi: tokenArtifact.abi,
    bytecode: tokenArtifact.bytecode.object as Hex,
  });
  const usdtAddress = (
    await publicClient.waitForTransactionReceipt({ hash: deployUsdtHash })
  ).contractAddress!;

  // Deploy USDC (EIP-3009 Mock)
  const deployUsdcHash = await walletClient.deployContract({
    account: deployer,
    abi: eip3009Artifact.abi,
    bytecode: eip3009Artifact.bytecode.object as Hex,
  });
  const usdcAddress = (
    await publicClient.waitForTransactionReceipt({ hash: deployUsdcHash })
  ).contractAddress!;

  // Read USDC EIP-712 domain (name, version)
  const usdcDomain = (await publicClient.readContract({
    address: usdcAddress,
    abi: eip3009Artifact.abi,
    functionName: "eip712Domain",
  })) as [Hex, string, string, bigint, string, Hex, bigint[]];
  const usdcName = usdcDomain[1];
  const usdcVersion = usdcDomain[2];

  // Mint to Buyer (1000 USDT + 1000 USDC)
  await walletClient.writeContract({
    account: deployer,
    address: usdtAddress,
    abi: tokenArtifact.abi,
    functionName: "mint",
    args: [buyer.address, parseEther("1000")],
  });
  await walletClient.writeContract({
    account: deployer,
    address: usdcAddress,
    abi: eip3009Artifact.abi,
    functionName: "mint",
    args: [buyer.address, parseEther("1000")],
  });

  // Fund Relayer (1 ETH)
  await walletClient.sendTransaction({
    account: deployer,
    to: relayer.address,
    value: parseEther("1"),
  });

  detail("delegate", `${CYAN}${delegateAddress}${RESET}`);
  detail("usdt", `${CYAN}${usdtAddress}${RESET}`);
  detail("usdc", `${CYAN}${usdcAddress}${RESET} (${usdcName} v${usdcVersion})`);
  detail(
    "buyer",
    `${buyer.address.slice(0, 6)}.. ${CYAN}1000 USDT + 1000 USDC${RESET}`,
  );
  detail("relayer", `${relayer.address.slice(0, 6)}.. ${CYAN}1 ETH${RESET}`);

  topology(delegateAddress, usdtAddress);

  // 3. Start Agents
  step(3, "Starting Agents");

  // Buyer (Agent 2)
  const buyerAgent = spawn(
    process.execPath,
    [path.resolve(__dirname, "../buyer-server.js")],
    {
      env: {
        ...process.env,
        PORT: String(BUYER_PORT),
        WEATHER_AGENT_URL: `http://localhost:${SELLER_PORT}/weather`,
        BUYER_KEY: BUYER_KEY,
        DELEGATE_ADDRESS: delegateAddress,
        TOKEN_ADDRESS: usdtAddress,
        USDC_ADDRESS: usdcAddress,
        USDC_NAME: usdcName,
        USDC_VERSION: usdcVersion,
        ANVIL_RPC: `http://127.0.0.1:${ANVIL_PORT}`,
      },
      stdio: "pipe",
    },
  );

  // Seller (Agent 1)
  const sellerAgent = spawn(
    process.execPath,
    [path.resolve(__dirname, "../weather-server.js")],
    {
      env: {
        ...process.env,
        PORT: String(SELLER_PORT),
        FACILITATOR_URL: `http://localhost:${FACILITATOR_PORT}`,
        SELLER_KEY: SELLER_KEY,
        TOKEN_ADDRESS: usdtAddress,
        USDC_ADDRESS: usdcAddress,
        USDC_NAME: usdcName,
        USDC_VERSION: usdcVersion,
        ANVIL_RPC: `http://127.0.0.1:${ANVIL_PORT}`,
      },
      stdio: "pipe",
    },
  );

  // Stream logs
  const handleLog = (agent: string, data: Buffer) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      broadcastLog(agent, line);
    }
  };

  buyerAgent.stdout.on("data", (d: Buffer) => handleLog("Agent 2", d));
  buyerAgent.stderr.on("data", (d: Buffer) => handleLog("Agent 2", d));
  sellerAgent.stdout.on("data", (d: Buffer) => handleLog("Agent 1", d));
  sellerAgent.stderr.on("data", (d: Buffer) => handleLog("Agent 1", d));

  await new Promise((r) => setTimeout(r, 1000));
  ok(`Buyer on :${BUYER_PORT}`);
  ok(`Seller on :${SELLER_PORT}`);

  // 4. Start UI
  step(4, "Starting UI");

  function startWebServer() {
    const publicDir = path.resolve(__dirname, "../../public");

    serve(WEB_PORT, async (req) => {
      const url = new URL(req.url);

      if (url.pathname === "/logs") {
        return new Response(
          new ReadableStream({
            start(controller) {
              logClients.add(controller);
            },
            cancel(controller) {
              logClients.delete(controller);
            },
          }),
          {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          },
        );
      }

      let filePath = path.join(
        publicDir,
        url.pathname === "/" ? "index.html" : url.pathname,
      );
      if (!filePath.startsWith(publicDir))
        return new Response("Forbidden", { status: 403 });

      try {
        const content = fs.readFileSync(filePath);
        return new Response(content, {
          headers: { "Content-Type": getMime(filePath) },
        });
      } catch (e) {
        return new Response("Not Found", { status: 404 });
      }
    });

    console.log(`
${DIM}──────────────────────────────────────────────${RESET}
  ${CYAN}UI/UX${RESET}           http://localhost:${WEB_PORT}
${DIM}──────────────────────────────────────────────${RESET}`);
  }

  startWebServer();

  // 5. Instructions
  step(5, "Start Facilitator");

  function detectServerCommand() {
    const isBun = typeof process.versions.bun !== "undefined";
    const userAgent = process.env.npm_config_user_agent || "";
    const currentScript = process.argv[1] || "";

    // Check if running locally within the monorepo structure
    if (currentScript.includes("packages/demo")) {
      // Try to construct the server path by swapping "demo" with "server"
      // Works for: .../packages/demo/dist/bin/demo.js -> .../packages/server/dist/bin/server.js
      // Works for: .../packages/demo/src/bin/demo.ts  -> .../packages/server/src/bin/server.ts
      let serverScript = currentScript
        .replace("packages/demo", "packages/server")
        .replace(/demo\.(js|ts)$/, "server.$1");

      if (fs.existsSync(serverScript)) {
        const relativePath = path.relative(process.cwd(), serverScript);
        const runtime = isBun ? "bun" : "node";
        return `${runtime} ${relativePath}`;
      }
    }

    // Fallback to package manager runners
    if (userAgent.startsWith("bun") || isBun) {
      return "bunx @facilitator/server";
    }
    if (userAgent.startsWith("yarn")) {
      return "yarn dlx @facilitator/server";
    }
    if (userAgent.startsWith("pnpm")) {
      return "pnpm dlx @facilitator/server";
    }

    return "npx @facilitator/server";
  }

  const serverCommand = detectServerCommand();

  console.log(`
${YELLOW}Run in a new terminal:${RESET}

  ${CYAN}${serverCommand} \\
    --relayer-key ${RELAYER_KEY} \\
    --delegate-address ${delegateAddress} \\
    --rpc-url http://127.0.0.1:${ANVIL_PORT}${RESET}

Then open ${BOLD}http://localhost:${WEB_PORT}${RESET} and click ${BOLD}INITIATE${RESET}.
`);

  // Keep alive
  setInterval(() => {}, 10000);
}

main().catch(console.error);
