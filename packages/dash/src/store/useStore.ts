import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { get, set, del, clear } from 'idb-keyval';

export interface Network {
  id: string; // usually chainId string
  name: string;
  rpcUrl: string;
  currency: string;
}

export interface Facilitator {
  id: string; // address
  networkId: string;
  label: string;
  privateKey?: string;
}

export interface HistoryPoint {
  timestamp: number;
  balance: string; // in wei
  txCount: number;
}

export interface FacilitatorStats {
  balance: string;
  txCount: number;
  lastUpdated: number;
  history: HistoryPoint[];
}

export interface TokenTransfer {
  address: string; // token contract
  symbol?: string;
  amount: string;
  from: string; // actual token sender (payer EOA)
  to: string;   // payment recipient
}

export interface Transaction {
  hash: string;
  networkId: string;
  from: string; // facilitator
  to: string | null;
  value: string; // wei
  gasCost?: string; // wei (gasUsed * effectiveGasPrice)
  timestamp: number;
  blockNumber: number;
  tokensTransferred: TokenTransfer[];
}

export interface TokenMetadata {
  symbol: string;
  decimals: number;
}

interface AppState {
  networks: Network[];
  facilitators: Facilitator[];
  stats: Record<string, FacilitatorStats>; // key: `${networkId}:${address}`
  gasPrices: Record<string, string>; // key: networkId, value: gasPrice in wei
  transactions: Transaction[];
  tokenMetadata: Record<string, TokenMetadata>; // key: contract address (lowercase)
  theme: 'dark' | 'light' | 'system';
  
  addNetwork: (network: Network) => void;
  removeNetwork: (id: string) => void;
  updateNetwork: (id: string, network: Partial<Network>) => void;

  addFacilitator: (facilitator: Facilitator) => void;
  removeFacilitator: (id: string, networkId: string) => void;
  updateFacilitator: (id: string, facilitator: Partial<Facilitator>) => void;

  updateStats: (key: string, stats: Partial<FacilitatorStats>) => void;
  updateGasPrice: (networkId: string, price: string) => void;
  addHistoryPoint: (key: string, point: HistoryPoint) => void;
  addTransactions: (txs: Transaction[]) => void;
  addTokenMetadata: (address: string, metadata: TokenMetadata) => void;
  clearAllData: () => Promise<void>;
  
  // New actions for targeted clearing
  clearStats: () => void;
  clearTransactions: () => void;

  setTheme: (theme: 'dark' | 'light' | 'system') => void;
}

// Custom storage adapter for IndexedDB
const storage = {
  getItem: async (name: string): Promise<string | null> => {
    return (await get(name)) || null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await set(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name);
  },
};

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      networks: [
        { id: '31337', name: 'Anvil Local', rpcUrl: 'http://127.0.0.1:8545', currency: 'ETH' }
      ],
      facilitators: [],
      stats: {},
      gasPrices: {},
      transactions: [],
      tokenMetadata: {},
      theme: 'system',

      addNetwork: (network) => set((state) => ({ networks: [...state.networks, network] })),
      removeNetwork: (id) => set((state) => ({ networks: state.networks.filter((n) => n.id !== id) })),
      updateNetwork: (id, net) => set((state) => ({
        networks: state.networks.map((n) => (n.id === id ? { ...n, ...net } : n))
      })),

      addFacilitator: (f) => set((state) => ({ facilitators: [...state.facilitators, f] })),
      removeFacilitator: (id, networkId) => set((state) => {
        const key = `${networkId}:${id}`;
        const newStats = { ...state.stats };
        delete newStats[key];
        return { 
          facilitators: state.facilitators.filter((f) => !(f.id === id && f.networkId === networkId)),
          stats: newStats
        };
      }),
      updateFacilitator: (id, f) => set((state) => ({
        facilitators: state.facilitators.map((fac) => (fac.id === id ? { ...fac, ...f } : fac))
      })),

      updateStats: (key, newStats) => set((state) => ({
        stats: {
          ...state.stats,
          [key]: {
            ...(state.stats[key] || { balance: '0', txCount: 0, lastUpdated: 0, history: [] }),
            ...newStats
          }
        }
      })),

      updateGasPrice: (networkId, price) => set((state) => ({
        gasPrices: {
          ...state.gasPrices,
          [networkId]: price
        }
      })),

      addHistoryPoint: (key, point) => set((state) => {
        const currentStats = state.stats[key] || { balance: '0', txCount: 0, lastUpdated: 0, history: [] };
        const history = [...currentStats.history, point].slice(-2000); // keep last 2000 points
        return {
          stats: {
            ...state.stats,
            [key]: {
              ...currentStats,
              history
            }
          }
        };
      }),

      addTransactions: (newTxs) => set((state) => {
          const txMap = new Map(state.transactions.map(t => [t.hash, t]));
          
          newTxs.forEach(tx => {
              // Update existing or add new. Prefer new data if it has gasCost when old didn't.
              const existing = txMap.get(tx.hash);
              if (existing) {
                  txMap.set(tx.hash, { ...existing, ...tx });
              } else {
                  txMap.set(tx.hash, tx);
              }
          });

          return {
              transactions: Array.from(txMap.values())
                  .sort((a, b) => b.timestamp - a.timestamp)
                  .slice(0, 5000)
          };
      }),

      addTokenMetadata: (address, metadata) => set((state) => ({
        tokenMetadata: {
          ...state.tokenMetadata,
          [address.toLowerCase()]: metadata
        }
      })),

      clearAllData: async () => {
          await clear(); // Clear IndexedDB
          set({
              networks: [{ id: '31337', name: 'Anvil Local', rpcUrl: 'http://127.0.0.1:8545', currency: 'ETH' }],
              facilitators: [],
              stats: {},
              gasPrices: {},
              transactions: [],
              tokenMetadata: {},
              theme: 'system'
          });
      },

      clearStats: () => set({ stats: {} }),
      clearTransactions: () => set({ transactions: [] }),

      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'facilitator-dashboard-storage-v2',
      storage: createJSONStorage(() => storage),
    }
  )
);
