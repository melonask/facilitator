import { DELEGATE_CONTRACT_ADDRESS, relayerAccount, getClients } from "./config";
import { formatEther } from "viem";
import { mechanism } from "./mechanism";
import { bazaarManager } from "./storage";
import type {
  DiscoveryResponse,
  SettleRequest,
  SettleResponse,
  SupportedResponse,
  VerifyRequest,
  VerifyResponse,
} from "./types";

const PORT = Number(process.env.PORT) || 3000;

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

console.log(`x402 EIP-7702 Facilitator running on port ${PORT}`);
