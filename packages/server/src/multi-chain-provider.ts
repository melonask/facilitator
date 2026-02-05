import {
  type Account,
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  http,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";

export class MultiChainClientProvider {
  private publicClients = new Map<number, PublicClient>();
  private walletClients = new Map<number, WalletClient>();

  constructor(private account: Account) {}

  addChain(chainId: number, rpcUrls: string[]) {
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

  getPublicClient(chainId: number): PublicClient {
    const client = this.publicClients.get(chainId);
    if (!client) {
      throw new Error(`No configuration found for chain ${chainId}`);
    }
    return client;
  }

  getWalletClient(chainId: number): WalletClient {
    const client = this.walletClients.get(chainId);
    if (!client) {
      throw new Error(`No configuration found for chain ${chainId}`);
    }
    return client;
  }

  getChainIds(): number[] {
    return Array.from(this.publicClients.keys());
  }
}
