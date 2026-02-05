import { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { type Address, formatEther } from "viem";
import { type NonceManager } from "./types.js";

// --- Simple InMemory Nonce Manager ---
export class InMemoryNonceManager implements NonceManager {
  private used = new Set<string>();
  checkAndMark(nonce: string): boolean {
    if (this.used.has(nonce)) return false;
    this.used.add(nonce);
    return true;
  }
  has(nonce: string): boolean {
    return this.used.has(nonce);
  }
}

// --- Handler Factory ---
export function createHandler(
  facilitator: x402Facilitator,
  extra?: { publicClient: any; relayerAddress: string },
) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // CORS
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    const headers = { "Access-Control-Allow-Origin": "*" };

    try {
      if (req.method === "GET" && url.pathname === "/healthcheck") {
        return Response.json({ status: "ok" }, { headers });
      }

      if (req.method === "GET" && url.pathname === "/info" && extra) {
        const balance = await extra.publicClient.getBalance({
          address: extra.relayerAddress as Address,
        });
        return Response.json(
          {
            networks: [{ eth: formatEther(balance) }],
          },
          { headers },
        );
      }

      if (req.method === "GET" && url.pathname === "/supported") {
        return Response.json(facilitator.getSupported(), { headers });
      }

      if (req.method === "POST" && url.pathname === "/verify") {
        const body = (await req.json()) as {
          paymentPayload: PaymentPayload;
          paymentRequirements: PaymentRequirements;
        };
        if (!body.paymentPayload || !body.paymentRequirements) {
          return Response.json(
            { error: "Missing payload or requirements" },
            { status: 400, headers },
          );
        }
        const result = await facilitator.verify(
          body.paymentPayload,
          body.paymentRequirements,
        );
        return Response.json(result, { headers });
      }

      if (req.method === "POST" && url.pathname === "/settle") {
        const body = (await req.json()) as {
          paymentPayload: PaymentPayload;
          paymentRequirements: PaymentRequirements;
        };
        if (!body.paymentPayload || !body.paymentRequirements) {
          return Response.json(
            { error: "Missing payload or requirements" },
            { status: 400, headers },
          );
        }
        const result = await facilitator.settle(
          body.paymentPayload,
          body.paymentRequirements,
        );
        return Response.json(result, { headers });
      }

      return new Response("Not Found", { status: 404, headers });
    } catch (e: any) {
      console.error(e);
      return Response.json({ error: e.message }, { status: 500, headers });
    }
  };
}
