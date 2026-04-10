import { mainnet, optimism, bsc, polygon, base, arbitrum, avalanche } from "viem/chains";

export const DEFAULT_CHAIN_CONFIGS: Record<number, { name: string; rpcs: readonly string[]; nativeCurrency: { name: string; symbol: string; decimals: number } }> = {
  [mainnet.id]: { name: mainnet.name, rpcs: mainnet.rpcUrls.default.http, nativeCurrency: mainnet.nativeCurrency },
  [optimism.id]: { name: optimism.name, rpcs: optimism.rpcUrls.default.http, nativeCurrency: optimism.nativeCurrency },
  [bsc.id]: { name: bsc.name, rpcs: bsc.rpcUrls.default.http, nativeCurrency: bsc.nativeCurrency },
  [polygon.id]: { name: polygon.name, rpcs: polygon.rpcUrls.default.http, nativeCurrency: polygon.nativeCurrency },
  [base.id]: { name: base.name, rpcs: base.rpcUrls.default.http, nativeCurrency: base.nativeCurrency },
  [arbitrum.id]: { name: arbitrum.name, rpcs: arbitrum.rpcUrls.default.http, nativeCurrency: arbitrum.nativeCurrency },
  [avalanche.id]: { name: avalanche.name, rpcs: avalanche.rpcUrls.default.http, nativeCurrency: avalanche.nativeCurrency },
};

export const DEFAULT_CHAIN_IDS = Object.keys(DEFAULT_CHAIN_CONFIGS).map(Number);