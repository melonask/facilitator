import { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { type Address, formatEther } from "viem";
import type { FacilitatorDb } from "./db/index.js";
import { SettlementStore } from "./db/settlement-store.js";

export interface HandlerExtra {
  provider: {
    getPublicClient(chainId: number): { getBalance(args: { address: Address }): Promise<bigint> };
  };
  chainIds: number[];
  relayerAddress: string;
  db: FacilitatorDb | null;
}

export function createHandler(
  facilitator: x402Facilitator,
  extra: HandlerExtra,
) {
  const settlementStore = extra.db ? new SettlementStore(extra.db) : null;

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

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

      if (req.method === "GET" && url.pathname === "/info") {
        const balances: Record<number, string> = {};
        for (const chainId of extra.chainIds) {
          try {
            const client = extra.provider.getPublicClient(chainId);
            const balance = await client.getBalance({
              address: extra.relayerAddress as Address,
            });
            balances[chainId] = formatEther(balance);
          } catch {
            balances[chainId] = "0";
          }
        }
        return Response.json({ networks: balances }, { headers });
      }

      if (req.method === "GET" && url.pathname === "/supported") {
        return Response.json(facilitator.getSupported(), { headers });
      }

      if (req.method === "GET" && url.pathname === "/settlements") {
        if (!settlementStore) {
          return Response.json({ error: "Database not configured" }, { status: 503, headers });
        }
        const payer = url.searchParams.get("payer");
        const chainId = url.searchParams.get("chainId");
        if (!payer) {
          return Response.json({ error: "Missing payer query parameter" }, { status: 400, headers });
        }
        const records = await settlementStore.listByPayer(
          payer,
          chainId ? Number(chainId) : undefined,
        );
        return Response.json({ settlements: records }, { headers });
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

        const existing = settlementStore
          ? await findExistingSettlement(body.paymentPayload, body.paymentRequirements, settlementStore)
          : null;

        if (existing && existing.status === "confirmed") {
          return Response.json(
            {
              success: true,
              transaction: existing.txHash,
              network: body.paymentRequirements.network,
              payer: existing.payer,
            },
            { headers },
          );
        }

        const result = await facilitator.settle(
          body.paymentPayload,
          body.paymentRequirements,
        );

        if (result.success && settlementStore) {
          const payload = body.paymentPayload as Record<string, unknown>;
          const payloadInner = payload.payload as Record<string, unknown> | undefined;
          const intent = payloadInner?.intent as Record<string, unknown> | undefined;

          const chainId = Number(body.paymentRequirements.network.split(":")[1]);
          const payer = (result as Record<string, unknown>).payer as string | undefined;

          await settlementStore.record({
            txHash: result.transaction,
            chainId,
            payer: payer ?? "0x",
            payee: body.paymentRequirements.payTo,
            token: body.paymentRequirements.asset,
            amount: body.paymentRequirements.amount,
            nonce: (intent?.nonce as string) ?? "0",
            status: "confirmed",
          });
        }

        if (!result.success && result.errorReason && settlementStore) {
          const txHash = result.transaction;
          if (txHash) {
            await settlementStore.updateStatus(txHash, "reverted");
          }
        }

        return Response.json(result, { headers });
      }

      return new Response("Not Found", { status: 404, headers });
    } catch (e: any) {
      console.error(e);
      return Response.json({ error: e.message }, { status: 500, headers });
    }
  };
}

async function findExistingSettlement(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  store: SettlementStore,
): Promise<{ txHash: string; status: string; payer: string } | null> {
  try {
    const p = payload as Record<string, unknown>;
    const inner = p.payload as Record<string, unknown> | undefined;
    const intent = inner?.intent as Record<string, unknown> | undefined;
    const nonce = intent?.nonce as string | undefined;
    if (!nonce) return null;

    const chainId = Number(requirements.network.split(":")[1]);
    if (isNaN(chainId)) return null;

    const record = await store.findByNonceAndChain(nonce, chainId);
    if (!record) return null;

    return { txHash: record.txHash, status: record.status, payer: record.payer };
  } catch {
    return null;
  }
}