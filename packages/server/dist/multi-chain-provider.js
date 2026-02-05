import { createPublicClient, createWalletClient, defineChain, fallback, http, } from "viem";
export class MultiChainClientProvider {
    account;
    publicClients = new Map();
    walletClients = new Map();
    constructor(account) {
        this.account = account;
    }
    addChain(chainId, rpcUrls) {
        if (rpcUrls.length === 0) {
            throw new Error(`No RPC URLs provided for chain ${chainId}`);
        }
        const transports = rpcUrls.map((url) => http(url));
        const transport = fallback(transports);
        const chain = defineChain({
            id: chainId,
            name: `Chain ${chainId}`,
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: { default: { http: rpcUrls } },
        });
        const publicClient = createPublicClient({ chain, transport });
        const walletClient = createWalletClient({
            chain,
            transport,
            account: this.account,
        });
        this.publicClients.set(chainId, publicClient);
        this.walletClients.set(chainId, walletClient);
    }
    getPublicClient(chainId) {
        const client = this.publicClients.get(chainId);
        if (!client) {
            throw new Error(`No configuration found for chain ${chainId}`);
        }
        return client;
    }
    getWalletClient(chainId) {
        const client = this.walletClients.get(chainId);
        if (!client) {
            throw new Error(`No configuration found for chain ${chainId}`);
        }
        return client;
    }
    getChainIds() {
        return Array.from(this.publicClients.keys());
    }
}
