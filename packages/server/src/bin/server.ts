#!/usr/bin/env node
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { toFacilitatorEvmSigner, type FacilitatorEvmSigner } from "@x402/evm";
import { parseArgs } from "util";
import {
  type Address,
  type Hex,
  createPublicClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  Eip7702Mechanism,
  KNOWN_DELEGATE_ADDRESSES,
} from "@facilitator/eip7702";
import { createHandler, InMemoryNonceManager } from "../handler.js";
import { serve } from "./serve.js";
import { MultiChainClientProvider } from "../multi-chain-provider.js";

async function main() {
  const { values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port: { type: "string", short: "p", default: "8080" },
      host: { type: "string", short: "H", default: "0.0.0.0" },
      "relayer-key": { type: "string" },
      "delegate-address": { type: "string" },
      "rpc-url": { type: "string" }, // Legacy support
      chain: { type: "string", multiple: true }, // New: chainId=url1,url2
    },
    strict: false,
  });

  if (!args["relayer-key"]) {
    console.error("Missing required argument: --relayer-key");
    process.exit(1);
  }

  if (!args["rpc-url"] && (!args.chain || args.chain.length === 0)) {
    console.error("Missing chain configuration. Use --chain <id>=<rpc> or --rpc-url <rpc>");
    process.exit(1);
  }

  const PORT = Number(args.port);
  const HOST = args.host as string;
  const RELAYER_KEY = args["relayer-key"] as Hex;
  const account = privateKeyToAccount(RELAYER_KEY);
  
  const provider = new MultiChainClientProvider(account);
  const chainConfigs: { id: number; delegate: Address }[] = [];

  // Helper to parse config
  const addConfig = async (id: number, rpcs: string[]) => {
    provider.addChain(id, rpcs);
    
    // Resolve delegate address
    let delegate = (args["delegate-address"] as Address) ?? KNOWN_DELEGATE_ADDRESSES[id];
    
    if (!delegate) {
      console.warn(`Warning: No delegate address found for chain ${id}. EIP-7702 may fail.`);
    }
    chainConfigs.push({ id, delegate });
  };

  // 1. Process legacy --rpc-url
  if (args["rpc-url"]) {
    const rpc = args["rpc-url"] as string;
    try {
      const tempClient = createPublicClient({ transport: http(rpc) });
      const id = await tempClient.getChainId();
      await addConfig(id, [rpc]);
    } catch (e) {
      console.error(`Failed to connect to legacy RPC ${rpc}:`, e);
      process.exit(1);
    }
  }

  // 2. Process --chain id=url,url
  if (args.chain) {
    for (const item of args.chain) {
      if (typeof item !== "string") continue;
      const eqIdx = item.indexOf("=");
      if (eqIdx === -1) {
        console.error(`Invalid chain format: ${item}. Expected id=url1,url2`);
        process.exit(1);
      }
      const idStr = item.substring(0, eqIdx);
      const urlsStr = item.substring(eqIdx + 1);
      
      const id = Number(idStr);
      const urls = urlsStr.split(",");
      if (!provider.getChainIds().includes(id)) {
         await addConfig(id, urls);
      }
    }
  }

  const registeredChains = provider.getChainIds();
  if (registeredChains.length === 0) {
    console.error("No valid chains configured.");
    process.exit(1);
  }

  const nonceManager = new InMemoryNonceManager();
  const facilitator = new x402Facilitator();

  // --- Register Mechanisms ---
  
  const globalDelegateOverride = args["delegate-address"] as Address | undefined;
  
  const eip7702 = new Eip7702Mechanism({
    delegateAddress: globalDelegateOverride, 
    relayerAccount: account,
    clientProvider: provider,
    nonceManager,
  });
  
  // Register EIP-7702 for all chains
  facilitator.register(
    registeredChains.map(id => `eip155:${id}`) as any, 
    eip7702
  );

  // 2. ERC-3009 (Requires per-chain signer for `ExactEvmScheme`)
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
  console.log(`Supported Chains: ${registeredChains.join(", ")}`);
  console.log(`Mechanisms:`);
  console.log(`  - EIP-7702 (Native/Any Token)`);
  console.log(`  - ERC-3009 (USDC/Permit2)`);

  serve(
    PORT,
    HOST,
    createHandler(facilitator, {
      publicClient: provider.getPublicClient(registeredChains[0]!),
      relayerAddress: account.address,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});