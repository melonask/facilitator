#!/usr/bin/env node
import { x402Facilitator } from "@x402/core/facilitator";
import { parseArgs } from "util";
import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Eip7702Mechanism, KNOWN_DELEGATE_ADDRESSES } from "../eip7702.js";
import { createHandler, InMemoryNonceManager } from "../handler.js";
import { serve } from "./serve.js";

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

  if (!args["relayer-key"] || !args["rpc-url"]) {
    console.error("Missing required arguments: --relayer-key, --rpc-url");
    process.exit(1);
  }

  const PORT = Number(args.port);
  const HOST = args.host as string;
  const RELAYER_KEY = args["relayer-key"] as Hex;
  const RPC_URL = args["rpc-url"] as string;

  // --- Setup ---
  const account = privateKeyToAccount(RELAYER_KEY);

  // Auto-detect chain ID from RPC
  const tempClient = createPublicClient({ transport: http(RPC_URL) });
  const chainId = await tempClient.getChainId();

  // Resolve delegate address: CLI flag takes priority, then known presets
  const DELEGATE_ADDRESS: Address =
    (args["delegate-address"] as Address) ?? KNOWN_DELEGATE_ADDRESSES[chainId];

  if (!DELEGATE_ADDRESS) {
    console.error(
      `No --delegate-address provided and no known preset for chain ${chainId}. ` +
        `Supported chains: ${Object.keys(KNOWN_DELEGATE_ADDRESSES).join(", ")}`,
    );
    process.exit(1);
  }

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
