#!/usr/bin/env node
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { toFacilitatorEvmSigner, type FacilitatorEvmSigner } from "@x402/evm";
import { parseArgs } from "util";
import { type Address, type Hex, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  Eip7702Mechanism,
  KNOWN_DELEGATE_ADDRESSES,
  type NonceManager,
} from "@facilitator/eip7702";
import { createHandler } from "../handler.js";
import { serve } from "./serve.js";
import { MultiChainClientProvider } from "../multi-chain-provider.js";
import { createDb } from "../db/index.js";
import { DbNonceManager } from "../db/db-nonce-manager.js";
import type { FacilitatorDb } from "../db/index.js";
import { DEFAULT_CHAIN_CONFIGS, DEFAULT_CHAIN_IDS } from "../chains.js";

class InMemoryNonceManager implements NonceManager {
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

function isUrl(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://");
}

async function detectChainId(rpcUrl: string): Promise<number> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return client.getChainId();
}

async function main() {
  const { values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port: { type: "string", short: "p", default: "8080" },
      host: { type: "string", short: "H", default: "0.0.0.0" },
      "relayer-key": { type: "string" },
      "delegate-address": { type: "string" },
      chain: { type: "string", multiple: true },
      db: { type: "string" },
    },
    strict: false,
  });

  if (!args["relayer-key"]) {
    console.error("Missing required argument: --relayer-key");
    process.exit(1);
  }

  const PORT = Number(args.port);
  const HOST = args.host as string;
  const RELAYER_KEY = args["relayer-key"] as Hex;
  const account = privateKeyToAccount(RELAYER_KEY);

  const provider = new MultiChainClientProvider(account);
  const chainConfigs: { id: number; delegate: Address }[] = [];

  const addConfig = async (id: number, rpcs: readonly string[]) => {
    const chainConfig = DEFAULT_CHAIN_CONFIGS[id];
    provider.addChain(id, rpcs, chainConfig?.nativeCurrency);

    let delegate = (args["delegate-address"] as Address) ?? KNOWN_DELEGATE_ADDRESSES[id];

    if (!delegate) {
      console.warn(`Warning: No delegate address found for chain ${id}. EIP-7702 may fail.`);
    }
    chainConfigs.push({ id, delegate });
  };

  // --- Parse --chain arguments ---
  // Formats:
  //   --chain 8453=https://mainnet.base.org   (chain ID + RPC URL)
  //   --chain https://mainnet.base.org          (RPC URL only, auto-detect chain ID)
  //   --chain 8453                              (chain ID only, use default RPC)
  //   (no --chain)                              (all known chains with default RPCs)

  const chainArgs = (args.chain ?? []) as string[];

  if (chainArgs.length === 0) {
    // Default: all known chains
    for (const chainId of DEFAULT_CHAIN_IDS) {
      const config = DEFAULT_CHAIN_CONFIGS[chainId]!;
      await addConfig(chainId, config.rpcs);
    }
  } else {
    for (const item of chainArgs) {
      if (typeof item !== "string") continue;

      const eqIdx = item.indexOf("=");

      if (eqIdx !== -1) {
        // Format: 8453=https://mainnet.base.org
        const idStr = item.substring(0, eqIdx);
        const urlStr = item.substring(eqIdx + 1);
        const id = Number(idStr);
        if (isNaN(id) || id <= 0) {
          console.error(`Invalid chain ID: ${idStr}`);
          process.exit(1);
        }
        if (!provider.getChainIds().includes(id)) {
          await addConfig(id, [urlStr]);
        }
      } else if (isUrl(item)) {
        // Format: https://mainnet.base.org
        try {
          const id = await detectChainId(item);
          if (!provider.getChainIds().includes(id)) {
            await addConfig(id, [item]);
          }
        } catch (e) {
          console.error(`Failed to detect chain ID from RPC ${item}:`, e);
          process.exit(1);
        }
      } else {
        // Format: 8453 (chain ID only, use default RPC)
        const id = Number(item);
        if (isNaN(id) || id <= 0) {
          console.error(`Invalid chain argument: ${item}. Expected chain ID, URL, or id=url format.`);
          process.exit(1);
        }
        const defaultRpc = DEFAULT_CHAIN_CONFIGS[id]?.rpcs;
        if (defaultRpc) {
          if (!provider.getChainIds().includes(id)) {
            await addConfig(id, defaultRpc);
          }
        } else {
          console.error(`No default RPC for chain ${id}. Provide an RPC URL: --chain ${id}=<rpc-url>`);
          process.exit(1);
        }
      }
    }
  }

  const registeredChains = provider.getChainIds();
  if (registeredChains.length === 0) {
    console.error("No valid chains configured.");
    process.exit(1);
  }

  // --- Database ---
  const dbArg = args.db as string | undefined;
  const dbResult = await createDb(dbArg);
  let db: FacilitatorDb | null = null;

  let nonceManager: NonceManager;
  if (dbResult) {
    db = dbResult.db;
    nonceManager = new DbNonceManager(db);
    console.log(`Database: ${dbResult.config.type} (${dbResult.config.url})`);
  } else {
    nonceManager = new InMemoryNonceManager();
    console.warn("Warning: No database configured. Nonce state and settlement history will be lost on restart.");
    console.warn("Use --db <path|url> or set PGHOST/PGDATABASE environment variables.");
  }

  const facilitator = new x402Facilitator();

  // --- Register Mechanisms ---

  const globalDelegateOverride = args["delegate-address"] as Address | undefined;

  const eip7702 = new Eip7702Mechanism({
    delegateAddress: globalDelegateOverride,
    relayerAccount: account,
    clientProvider: provider,
    nonceManager,
  });

  facilitator.register(
    registeredChains.map(id => `eip155:${id}`) as any,
    eip7702
  );

  for (const chainId of registeredChains) {
    const publicClient = provider.getPublicClient(chainId);
    const walletClient = provider.getWalletClient(chainId);

    const evmSigner = toFacilitatorEvmSigner({
      ...publicClient,
      ...walletClient,
      address: account.address,
    } as Omit<FacilitatorEvmSigner, "getAddresses"> & { address: `0x${string}` });

    const erc3009 = new ExactEvmScheme(evmSigner);
    facilitator.register([`eip155:${chainId}`] as any, erc3009);
  }

  // --- Server ---
  console.log(`Starting Facilitator on http://${HOST}:${PORT}`);
  console.log(`Supported Chains: ${registeredChains.map(id => `${id} (${DEFAULT_CHAIN_CONFIGS[id]?.name ?? 'unknown'})`).join(", ")}`);
  console.log(`Mechanisms:`);
  console.log(`  - EIP-7702 (Native/Any Token)`);
  console.log(`  - ERC-3009 (USDC/Permit2)`);

  const server = serve(
    PORT,
    HOST,
    createHandler(facilitator, {
      provider,
      chainIds: registeredChains,
      relayerAddress: account.address,
      db,
    }),
  );

  const shutdown = async () => {
    console.log("\nShutting down...");
    if (db) {
      await db.close();
      console.log("Database connection closed.");
    }
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});