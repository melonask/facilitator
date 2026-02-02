import { parseArgs } from "util";

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
if (args["relayer-private-key"])
  process.env.RELAYER_PRIVATE_KEY = args["relayer-private-key"] as string;
if (args["delegate-address"])
  process.env.DELEGATE_ADDRESS = args["delegate-address"] as string;
if (args["rpc-url"]) {
  for (const entry of args["rpc-url"] as string[]) {
    const eq = entry.indexOf("=");
    if (eq === -1) {
      console.error(
        `Invalid --rpc-url format: "${entry}" (expected chainId=url)`,
      );
      process.exit(1);
    }
    process.env[`RPC_URL_${entry.slice(0, eq)}`] = entry.slice(eq + 1);
  }
}

const PORT = Number(args.port ?? process.env.PORT) || 3000;
const HOST = (args.host as string) ?? process.env.HOST ?? "0.0.0.0";

// Import after env is populated from CLI args
const { getSupportedNetworks } = await import("./config");
const { x402Facilitator } = await import("@x402/core/facilitator");
const { Eip7702Mechanism } = await import("./schemes/eip7702");
const { ExactEvmMechanism } = await import("./schemes/exact");
const { log } = await import("./logger");
const { bazaarManager } = await import("./storage");
const {
  CORS_HEADERS,
  json,
  setFacilitator,
  handleHealthcheck,
  handleSupported,
  handleDiscovery,
  handleVerifySchema,
  handleSettleSchema,
  handleVerify,
  handleSettle,
  handleInfo,
} = await import("./handlers");

// --- Facilitator Setup ---

/** Normalize a resource URL to origin+pathname (strip query params and hash). */
function normalizeResourceUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return raw;
  }
}

/** Extract HTTP method from bazaar extension info, if present. */
function extractMethodFromExtension(
  ext: Record<string, unknown> | undefined,
): string | undefined {
  if (!ext) return undefined;
  const info = ext.info as Record<string, unknown> | undefined;
  if (!info) return undefined;
  const input = info.input as Record<string, unknown> | undefined;
  return (input?.method as string) ?? undefined;
}

const supportedNetworks = getSupportedNetworks();
const facilitator = new x402Facilitator();
facilitator.register(supportedNetworks, new Eip7702Mechanism());
facilitator.register(supportedNetworks, new ExactEvmMechanism());
facilitator.registerExtension("bazaar");

facilitator.onAfterSettle(async (ctx) => {
  if (!ctx.result.success) return;

  const resourceUrl = ctx.paymentPayload.resource?.url;
  if (!resourceUrl) return;

  const bazaarExt = ctx.paymentPayload.extensions?.bazaar as
    | Record<string, unknown>
    | undefined;

  bazaarManager.upsert({
    resource: normalizeResourceUrl(resourceUrl),
    type: "http",
    method: extractMethodFromExtension(bazaarExt),
    x402Version: ctx.paymentPayload.x402Version ?? 2,
    accepts: [ctx.requirements],
    lastUpdated: new Date().toISOString(),
    metadata: bazaarExt,
  });
});

setFacilitator(facilitator);

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
        if (url.pathname === "/supported" || url.pathname === "/health")
          return handleSupported();
        if (url.pathname === "/discovery/resources")
          return handleDiscovery(url);
        if (url.pathname === "/verify") return handleVerifySchema();
        if (url.pathname === "/settle") return handleSettleSchema();
        if (url.pathname === "/info") return await handleInfo(url);
      }

      if (req.method === "POST") {
        if (url.pathname === "/verify") return await handleVerify(req);
        if (url.pathname === "/settle") return await handleSettle(req);
      }

      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    } catch (e) {
      log.error("Request failed", {
        error: (e as Error).message,
        path: url.pathname,
      });
      return json({ error: (e as Error).message }, 500);
    }
  },
});

log.info("Server started", { host: HOST, port: PORT });
