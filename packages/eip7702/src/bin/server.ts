#!/usr/bin/env node
import { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { parseArgs } from "util";
import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Eip7702Mechanism } from "../eip7702.js";
import { type NonceManager } from "../types.js";
import { serve } from "./serve.js";

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

// --- Main execution ---
async function main() {
  const { values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port: { type: "string", short: "p", default: "8080" },
      host: { type: "string", short: "H", default: "0.0.0.0" },
      "relayer-key": { type: "string" },
      "delegate-address": { type: "string" },
      "rpc-url": { type: "string" },
    },
    strict: false,
  });

  if (!args["relayer-key"] || !args["delegate-address"] || !args["rpc-url"]) {
    console.error(
      "Missing required arguments: --relayer-key, --delegate-address, --rpc-url",
    );
    process.exit(1);
  }

  const PORT = Number(args.port);
  const HOST = args.host as string;
  const RELAYER_KEY = args["relayer-key"] as Hex;
  const DELEGATE_ADDRESS = args["delegate-address"] as Address;
  const RPC_URL = args["rpc-url"] as string;

  // --- Setup ---
  const account = privateKeyToAccount(RELAYER_KEY);

  // Auto-detect chain ID from RPC
  const tempClient = createPublicClient({ transport: http(RPC_URL) });
  const chainId = await tempClient.getChainId();

  const chain = defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });

  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

  const clientProvider = {
    getPublicClient: (_: number) => publicClient,
    getWalletClient: (_: number) =>
      createWalletClient({ chain, transport: http(RPC_URL), account }),
  };

  const mechanism = new Eip7702Mechanism({
    delegateAddress: DELEGATE_ADDRESS,
    relayerAccount: account,
    clientProvider,
    nonceManager: new InMemoryNonceManager(),
  });

  const facilitator = new x402Facilitator();
  facilitator.register([`eip155:${chainId}`], mechanism);

  // --- Server ---
  console.log(
    `Starting EIP-7702 Facilitator on http://${HOST}:${PORT} (chain: ${chainId})`,
  );

  serve(
    PORT,
    HOST,
    createHandler(facilitator, {
      publicClient,
      relayerAddress: account.address,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
