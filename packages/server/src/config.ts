import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY as `0x${string}`;
if (!RELAYER_PRIVATE_KEY) throw new Error("RELAYER_PRIVATE_KEY is required");

export const relayerAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY);

export const DELEGATE_CONTRACT_ADDRESS = (process.env.DELEGATE_ADDRESS ??
  "") as `0x${string}`;
if (!DELEGATE_CONTRACT_ADDRESS || DELEGATE_CONTRACT_ADDRESS.length !== 42) {
  throw new Error(
    "DELEGATE_ADDRESS must be a valid 42-character hex address (0x...)",
  );
}

function buildClients(chainId: number) {
  const rpcUrl = process.env[`RPC_URL_${chainId}`];
  if (!rpcUrl) {
    throw new Error(
      `RPC URL for chain ${chainId} not configured (set RPC_URL_${chainId})`,
    );
  }

  const chain = defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  const transport = http(rpcUrl);

  return {
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({
      account: relayerAccount,
      chain,
      transport,
    }),
  };
}

/** Derive supported networks from RPC_URL_<chainId> env vars. */
export function getSupportedNetworks(): `${string}:${string}`[] {
  const networks: `${string}:${string}`[] = [];
  for (const key of Object.keys(process.env)) {
    const match = key.match(/^RPC_URL_(\d+)$/);
    if (match) {
      networks.push(`eip155:${match[1]}`);
    }
  }
  return networks;
}

type Clients = ReturnType<typeof buildClients>;
const clientCache = new Map<number, Clients>();

export function getClients(chainId: number): Clients {
  const cached = clientCache.get(chainId);
  if (cached) return cached;

  const clients = buildClients(chainId);
  clientCache.set(chainId, clients);
  return clients;
}
