import { parseArgs } from "util";
import type {
  DiscoveryResponse,
  SettleRequest,
  SettleResponse,
  SupportedResponse,
  VerifyRequest,
  VerifyResponse,
} from "./types";

const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: "string", short: "p" },
    host: { type: "string", short: "H" },
    "relayer-private-key": { type: "string" },
    "delegate-address": { type: "string" },
    "rpc-url": { type: "string", multiple: true },
    help: { type: "boolean", short: "h" },
  },
  strict: false,
});

if (args.help) {
  console.log(`Usage: facilitator-server [options]

Options:
  -p, --port <port>              Server port (default: 3000, env: PORT)
  -H, --host <host>              Server hostname (default: "0.0.0.0", env: HOST)
      --relayer-private-key <key>  Relayer private key (env: RELAYER_PRIVATE_KEY)
      --delegate-address <addr>  Delegate contract address (env: DELEGATE_ADDRESS)
      --rpc-url <chainId=url>    RPC endpoint, repeatable (env: RPC_URL_<chainId>)
  -h, --help                     Show this help message

Examples:
  facilitator-server --port 8080
  facilitator-server --relayer-private-key 0x... --delegate-address 0x... --rpc-url 1=https://eth.rpc.io
  facilitator-server --rpc-url 1=https://eth.rpc.io --rpc-url 8453=https://base.rpc.io`);
  process.exit(0);
}

// Apply CLI args to process.env before config module reads them
if (args["relayer-private-key"]) process.env.RELAYER_PRIVATE_KEY = args["relayer-private-key"] as string;
if (args["delegate-address"]) process.env.DELEGATE_ADDRESS = args["delegate-address"] as string;
if (args["rpc-url"]) {
  for (const entry of args["rpc-url"] as string[]) {
    const eq = entry.indexOf("=");
    if (eq === -1) {
      console.error(`Invalid --rpc-url format: "${entry}" (expected chainId=url)`);
      process.exit(1);
    }
    process.env[`RPC_URL_${entry.slice(0, eq)}`] = entry.slice(eq + 1);
  }
}

const PORT = Number(args.port ?? process.env.PORT) || 3000;
const HOST = (args.host as string) ?? process.env.HOST ?? "0.0.0.0";

// Import after env is populated from CLI args
const { DELEGATE_CONTRACT_ADDRESS, relayerAccount, getClients } = await import("./config");
const { formatEther } = await import("viem");
const { mechanism } = await import("./mechanism");
const { bazaarManager } = await import("./storage");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Payment-Signature",
} as const;

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: CORS_HEADERS });
}

// --- Route Handlers ---

function handleHealthcheck() {
  return json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
}

function handleSupported() {
  const response: SupportedResponse = {
    kinds: [
      {
        x402Version: 2,
        scheme: "eip7702",
        network: "eip155:*",
        extra: {},
      },
    ],
    extensions: ["bazaar"],
    signers: { "eip155:*": [relayerAccount.address] },
  };
  return json({ ...response, delegateContract: DELEGATE_CONTRACT_ADDRESS });
}

function handleDiscovery(url: URL) {
  const limit = Number(url.searchParams.get("limit")) || 100;
  const offset = Number(url.searchParams.get("offset")) || 0;
  const { items, total } = bazaarManager.list(limit, offset);

  const response: DiscoveryResponse = {
    x402Version: 2,
    items,
    pagination: { limit, offset, total },
  };
  return json(response);
}

async function handleVerify(req: Request) {
  const body = (await req.json()) as VerifyRequest;
  const result: VerifyResponse = await mechanism.verify(
    body.paymentPayload,
    body.paymentRequirements,
  );
  return json(result);
}

async function handleSettle(req: Request) {
  const body = (await req.json()) as SettleRequest;
  const result: SettleResponse = await mechanism.settle(
    body.paymentPayload,
    body.paymentRequirements,
  );

  if (result.success && body.paymentPayload.resource?.url) {
    bazaarManager.upsert({
      resource: body.paymentPayload.resource.url,
      type: "http",
      x402Version: 2,
      accepts: [body.paymentRequirements],
      lastUpdated: new Date().toISOString(),
      metadata: body.paymentPayload.extensions?.bazaar as
        | Record<string, unknown>
        | undefined,
    });
  }

  return json(result);
}

async function handleBalance() {
  try {
    // Default to Anvil chain ID 31337 for this demo
    const chainId = 31337; 
    const { publicClient } = getClients(chainId);
    const balance = await publicClient.getBalance({ address: relayerAccount.address });
    
    return json({
      address: relayerAccount.address,
      eth: formatEther(balance),
      chainId
    });
  } catch (e) {
    return json({ error: "Failed to fetch balance", details: (e as Error).message }, 500);
  }
}

// --- Server ---

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(req.url);

    try {
      if (req.method === "GET") {
        if (url.pathname === "/healthcheck") return handleHealthcheck();
        if (url.pathname === "/supported") return handleSupported();
        if (url.pathname === "/discovery/resources")
          return handleDiscovery(url);
        if (url.pathname === "/balance") return await handleBalance();
      }

      if (req.method === "POST") {
        if (url.pathname === "/verify") return await handleVerify(req);
        if (url.pathname === "/settle") return await handleSettle(req);
      }

      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    } catch (e) {
      console.error(e);
      return json({ error: (e as Error).message }, 500);
    }
  },
});

console.log(`x402 EIP-7702 Facilitator running on ${HOST}:${PORT}`);
