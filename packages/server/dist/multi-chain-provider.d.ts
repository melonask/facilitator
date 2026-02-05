import { type Account, type PublicClient, type WalletClient } from "viem";
export declare class MultiChainClientProvider {
    private account;
    private publicClients;
    private walletClients;
    constructor(account: Account);
    addChain(chainId: number, rpcUrls: string[]): void;
    getPublicClient(chainId: number): PublicClient;
    getWalletClient(chainId: number): WalletClient;
    getChainIds(): number[];
}
