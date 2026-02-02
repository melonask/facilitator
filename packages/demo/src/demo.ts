import { spawn } from "child_process";
import path from "node:path";
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
import delegateArtifact from "../../contracts/out/Delegate.sol/Delegate.json";
import tokenArtifact from "../../contracts/out/ERC20Mock.sol/ERC20Mock.json";

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

// ---- Pretty CLI helpers ----

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";

function banner() {
  console.log(`
${DIM}──────────────────────────────────────────────${RESET}
  ${BOLD}x402${RESET} ${DIM}//${RESET} EIP-7702 Agent Economy Demo
${DIM}──────────────────────────────────────────────${RESET}`);
}

function topology(delegate: string, token: string) {
  const d = delegate.slice(0, 6) + ".." + delegate.slice(-4);
  const t = token.slice(0, 6) + ".." + token.slice(-4);
  console.log(`
${DIM}  ┌─────────────┐          ┌─────────────┐${RESET}
${DIM}  │${RESET} ${BLUE}BUYER${RESET}       ${DIM}│${RESET}          ${DIM}│${RESET} ${RED}SELLER${RESET}      ${DIM}│${RESET}
${DIM}  │${RESET}  :${AGENT2_PORT}      ${DIM}│ ◄─x402─► │${RESET}  :${AGENT1_PORT}      ${DIM}│${RESET}
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
  console.log(`\n  ${DIM}[${n}]${RESET} ${label}`);
}

function detail(label: string, value: string) {
  console.log(`      ${DIM}${label}${RESET} ${value}`);
}

function ok(msg: string) {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}

function flowArrow(from: string, to: string, label: string) {
  console.log(`      ${DIM}${from} ──► ${to}${RESET}  ${label}`);
}

function done() {
  console.log(`
${DIM}──────────────────────────────────────────────${RESET}
  ${GREEN}${BOLD}Demo complete${RESET}
${DIM}──────────────────────────────────────────────${RESET}`);
}

async function main() {
  banner();

  const args = process.argv.slice(2);
  const headless = args.includes("--no-web") || args.includes("--headless");

  if (headless) {
    detail("mode", "headless (no web visualizer)");
  }

  // --- Web Mode State ---
  let isWebMode = false;
  const logClients: Set<any> = new Set();

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

  function startWebServer() {
    const WEB_PORT = 8080;
    const publicDir = path.resolve(import.meta.dir, "../public");

    Bun.serve({
      port: WEB_PORT,
      async fetch(req) {
        const url = new URL(req.url);

        // SSE Endpoint
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

        // Static Files
        let filePath = path.join(
          publicDir,
          url.pathname === "/" ? "index.html" : url.pathname,
        );

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
        } catch (e) {
          return new Response("Error", { status: 500 });
        }
      },
    });

    console.log(`
${DIM}──────────────────────────────────────────────${RESET}
  ${CYAN}Web Visualizer${RESET}  http://localhost:${WEB_PORT}
${DIM}──────────────────────────────────────────────${RESET}
  ${DIM}(keep this terminal open)${RESET}`);

    spawn("open", [`http://localhost:${WEB_PORT}`]);
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

  // Deploy Token
  const deployTokenHash = await walletClient.deployContract({
    account: deployer,
    abi: tokenArtifact.abi,
    bytecode: tokenArtifact.bytecode.object as Hex,
  });
  const tokenAddress = (
    await publicClient.waitForTransactionReceipt({ hash: deployTokenHash })
  ).contractAddress!;

  // Mint to Buyer (1000 Tokens)
  await walletClient.writeContract({
    account: deployer,
    address: tokenAddress,
    abi: tokenArtifact.abi,
    functionName: "mint",
    args: [buyer.address, parseEther("1000")],
  });

  // Fund Relayer (10 ETH)
  await walletClient.sendTransaction({
    account: deployer,
    to: relayer.address,
    value: parseEther("10"),
  });

  detail("delegate", `${CYAN}${delegateAddress}${RESET}`);
  detail("token", `${CYAN}${tokenAddress}${RESET}`);
  detail("buyer", `1000 TKN minted`);
  detail("relayer", `10 ETH funded`);

  topology(delegateAddress, tokenAddress);

  // 3. Start Facilitator
  step(3, "Starting Facilitator");
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
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  facilitator.stdout.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const log = JSON.parse(line);
        if (log.msg === "Verifying payment...") {
          flowArrow("seller", "facilitator", `${YELLOW}POST /verify${RESET}`);
          broadcastLog("Facilitator", line);
        } else if (log.msg === "Settling payment...") {
          flowArrow("seller", "facilitator", `${YELLOW}POST /settle${RESET}`);
          broadcastLog("Facilitator", line);
        } else if (log.msg === "Settlement successful") {
          const tx = log.hash
            ? `${DIM}tx ${CYAN}${log.hash.slice(0, 10)}..${RESET}`
            : "";
          flowArrow("facilitator", "chain", `${GREEN}settled${RESET} ${tx}`);
          broadcastLog("Facilitator", line);
        } else {
          broadcastLog("Facilitator", line);
        }
      } catch (e) {
        broadcastLog("Facilitator", line);
      }
    }
  });

  facilitator.stderr.on("data", (data) => {
    process.stderr.write(data);
    broadcastLog("Facilitator", data.toString());
  });

  await new Promise((r) => setTimeout(r, 1000));
  ok(`Facilitator on :${FACILITATOR_PORT}`);

  // 4. Start Agent 1 (Seller)
  step(4, "Starting Seller agent");
  const agent1 = spawn(
    "bun",
    ["run", path.resolve(import.meta.dir, "weather-server.ts")],
    {
      env: {
        ...process.env,
        PORT: String(AGENT1_PORT),
        FACILITATOR_URL: `http://localhost:${FACILITATOR_PORT}`,
        SELLER_KEY: SELLER_KEY,
        TOKEN_ADDRESS: tokenAddress,
        ANVIL_RPC: `http://127.0.0.1:${ANVIL_PORT}`,
      },
      stdio: "pipe",
    },
  );

  await new Promise((r) => setTimeout(r, 1000));
  ok(`Seller (weather) on :${AGENT1_PORT}`);

  // 5. Start Agent 2 (Buyer)
  step(5, "Starting Buyer agent");
  const agent2 = spawn(
    "bun",
    ["run", path.resolve(import.meta.dir, "buyer-server.ts")],
    {
      env: {
        ...process.env,
        PORT: String(AGENT2_PORT),
        WEATHER_AGENT_URL: `http://localhost:${AGENT1_PORT}/weather`,
        BUYER_KEY: BUYER_KEY,
        DELEGATE_ADDRESS: delegateAddress,
        TOKEN_ADDRESS: tokenAddress,
        ANVIL_RPC: `http://127.0.0.1:${ANVIL_PORT}`,
      },
      stdio: "pipe",
    },
  );
  ok(`Buyer on :${AGENT2_PORT}`);

  step(6, "Waiting for autonomous purchase");
  console.log(`
${DIM}  ── x402 protocol flow ──────────────────────${RESET}`);

  // Monitor Agent 2 output
  agent2.stdout.on("data", async (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (!line) continue;
      broadcastLog("Agent 2", line);

      if (line.includes("GET /weather")) {
        flowArrow("buyer", "seller", `${BLUE}GET /weather${RESET}`);
      } else if (line.includes("402")) {
        flowArrow("seller", "buyer", `${RED}402 Payment Required${RESET}`);
      } else if (line.includes("Signing") || line.includes("EIP-712")) {
        detail("buyer", `${MAGENTA}sign EIP-712 + EIP-7702${RESET}`);
      } else if (
        line.includes("Retrying") ||
        line.includes("Payment-Signature")
      ) {
        flowArrow("buyer", "seller", `${BLUE}GET /weather + payment${RESET}`);
      } else if (line.includes("Data Received") || line.includes("weather")) {
        flowArrow("seller", "buyer", `${GREEN}200 + data${RESET}`);

        done();

        // Check Bazaar Catalog
        console.log(`\n  ${DIM}Bazaar catalog:${RESET}`);
        try {
          const res = await fetch(
            `http://localhost:${FACILITATOR_PORT}/discovery/resources`,
          );
          const catalog = (await res.json()) as { items?: unknown[] };
          detail("items", `${catalog.items?.length ?? 0} resource(s) indexed`);
        } catch (e) {
          detail("catalog", `${RED}unreachable${RESET}`);
        }

        if (!isWebMode) {
          isWebMode = true;
          clearTimeout(timeout);

          if (headless) {
            console.log(`\n  ${GREEN}Done.${RESET} Exiting.\n`);
            cleanup();
          } else {
            startWebServer();
          }
        }
      }
    }
  });

  agent2.stderr.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (!line) continue;
      broadcastLog("Agent 2", line);
    }
  });

  // Monitor Agent 1 output
  agent1.stdout.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (!line) continue;
      broadcastLog("Agent 1", line);
    }
  });
  agent1.stderr.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (!line) continue;
      broadcastLog("Agent 1", line);
    }
  });

  // Timeout (Only applies to the initial run)
  const timeout = setTimeout(() => {
    if (!isWebMode) {
      console.error(`\n  ${RED}Timed out${RESET}`);
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
