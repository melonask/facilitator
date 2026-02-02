import { formatEther } from "viem";
import { relayerAccount, getClients, getSupportedNetworks } from "./config";
import { log } from "./logger";
import { bazaarManager } from "./storage";
import type {
  DiscoveryResponse,
  SettleRequest,
  SettleResponse,
  VerifyRequest,
  VerifyResponse,
} from "./types";
import type { x402Facilitator } from "@x402/core/facilitator";

// --- HTTP Helpers ---

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Payment-Signature",
} as const;

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: CORS_HEADERS });
}

// --- Route Handlers ---

let _facilitator: x402Facilitator;

export function setFacilitator(f: x402Facilitator) {
  _facilitator = f;
}

export function handleHealthcheck() {
  return json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
}

export function handleSupported() {
  return json(_facilitator.getSupported());
}

export function handleDiscovery(url: URL) {
  const limit = Number(url.searchParams.get("limit")) || 100;
  const offset = Number(url.searchParams.get("offset")) || 0;
  const type = url.searchParams.get("type") ?? undefined;
  const { items, total } = bazaarManager.list(limit, offset, type);

  const response: DiscoveryResponse = {
    x402Version: 2,
    items,
    pagination: { limit, offset, total },
  };
  return json(response);
}

export function handleVerifySchema() {
  return json({
    method: "POST",
    request: {
      paymentPayload: "PaymentPayload",
      paymentRequirements: "PaymentRequirements",
    },
    response: {
      isValid: "boolean",
      invalidReason: "string (optional)",
      payer: "string (optional)",
    },
  });
}

export function handleSettleSchema() {
  return json({
    method: "POST",
    request: {
      paymentPayload: "PaymentPayload",
      paymentRequirements: "PaymentRequirements",
    },
    response: {
      success: "boolean",
      transaction: "string",
      network: "string",
      payer: "string (optional)",
      errorReason: "string (optional)",
    },
  });
}

export async function handleVerify(req: Request) {
  log.info("Verifying payment...", { type: "verify" });
  const body = (await req.json()) as VerifyRequest;
  const result: VerifyResponse = await _facilitator.verify(
    body.paymentPayload,
    body.paymentRequirements,
  );
  return json(result);
}

export async function handleSettle(req: Request) {
  log.info("Settling payment...", { type: "settle" });
  const body = (await req.json()) as SettleRequest;
  const result: SettleResponse = await _facilitator.settle(
    body.paymentPayload,
    body.paymentRequirements,
  );
  return json(result);
}

export async function handleInfo(url: URL) {
  try {
    const chainIdParam = url.searchParams.get("chainId");
    const networks_ = getSupportedNetworks();

    let chainIds: number[];
    if (chainIdParam) {
      chainIds = [Number(chainIdParam)];
    } else {
      chainIds = networks_.map((n) => Number(n.split(":")[1]));
    }

    const networks = await Promise.all(
      chainIds.map(async (chainId) => {
        try {
          const { publicClient } = getClients(chainId);
          const balance = await publicClient.getBalance({
            address: relayerAccount.address,
          });
          return { chainId, eth: formatEther(balance) };
        } catch {
          return { chainId, eth: "0" };
        }
      }),
    );

    return json({
      address: relayerAccount.address,
      networks,
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
  } catch (e) {
    return json(
      { error: "Failed to fetch info", details: (e as Error).message },
      500,
    );
  }
}
