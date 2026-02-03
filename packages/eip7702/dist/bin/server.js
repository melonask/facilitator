#!/usr/bin/env node
import { x402Facilitator } from "@x402/core/facilitator";
import { parseArgs } from "util";
import { createPublicClient, createWalletClient, defineChain, http, } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Eip7702Mechanism } from "../eip7702.js";
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
    if (!args["relayer-key"] || !args["delegate-address"] || !args["rpc-url"]) {
        console.error("Missing required arguments: --relayer-key, --delegate-address, --rpc-url");
        process.exit(1);
    }
    const PORT = Number(args.port);
    const HOST = args.host;
    const RELAYER_KEY = args["relayer-key"];
    const DELEGATE_ADDRESS = args["delegate-address"];
    const RPC_URL = args["rpc-url"];
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
        getPublicClient: (_) => publicClient,
        getWalletClient: (_) => createWalletClient({ chain, transport: http(RPC_URL), account }),
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
    console.log(`Starting EIP-7702 Facilitator on http://${HOST}:${PORT} (chain: ${chainId})`);
    serve(PORT, HOST, createHandler(facilitator, {
        publicClient,
        relayerAddress: account.address,
    }));
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
