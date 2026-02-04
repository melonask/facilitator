import { useEffect, useRef } from 'react';
import { createPublicClient, http, parseAbiItem, decodeEventLog } from 'viem';
import { useStore, type Transaction, type TokenTransfer } from '@/store/useStore';

// Map to cache clients
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clients: Record<string, any> = {};
const lastScannedBlock: Record<string, bigint> = {};

const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const SYMBOL_ABI = parseAbiItem('function symbol() view returns (string)');
const DECIMALS_ABI = parseAbiItem('function decimals() view returns (uint8)');

export function DataManager() {
  const { networks, facilitators, updateStats, updateGasPrice, addHistoryPoint, addTransactions, tokenMetadata, addTokenMetadata } = useStore();
  const isScanning = useRef(false);

  // Poll for basic stats (Balance, Nonce, Gas Price)
  useEffect(() => {
    const fetchStats = async () => {
      for (const network of networks) {
        if (!network.rpcUrl) continue;

        if (!clients[network.id]) {
             clients[network.id] = createPublicClient({ 
                transport: http(network.rpcUrl)
             });
        }
        const client = clients[network.id];
        
        // Fetch Gas Price
        try {
            const gasPrice = await client.getGasPrice();
            updateGasPrice(network.id, gasPrice.toString());
        } catch (e) {
            console.error(`Failed to fetch gas price for ${network.name}`, e);
        }

        const networkFacilitators = facilitators.filter(f => f.networkId === network.id);
        
        for (const fac of networkFacilitators) {
          try {
             const [balance, nonce] = await Promise.all([
                client.getBalance({ address: fac.id as `0x${string}` }),
                client.getTransactionCount({ address: fac.id as `0x${string}` })
             ]);

             const key = `${network.id}:${fac.id}`;
             const timestamp = Date.now();
             
             updateStats(key, {
                balance: balance.toString(),
                txCount: nonce,
                lastUpdated: timestamp
             });

             addHistoryPoint(key, {
                timestamp,
                balance: balance.toString(),
                txCount: nonce
             });
          } catch (e) {
            console.error(`Failed to fetch stats for ${fac.id} on ${network.name}`, e);
          }
        }
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000); 
    return () => clearInterval(interval);
  }, [networks, facilitators, updateStats, updateGasPrice, addHistoryPoint]);

  // Poll for Transactions (Block Scanning)
  useEffect(() => {
      const scanBlocks = async () => {
          if (isScanning.current) return;
          isScanning.current = true;

          for (const network of networks) {
              if (!network.rpcUrl) continue;
              const client = clients[network.id]; // Assumes client created in stats effect or create here
              if (!client) continue;

              const networkFacilitators = facilitators.filter(f => f.networkId === network.id);
              if (networkFacilitators.length === 0) continue;

              const trackedAddresses = new Set(networkFacilitators.map(f => f.id.toLowerCase()));

              try {
                  const currentBlock = await client.getBlockNumber();
                  
                  // Initialize start block if first run
                  if (!lastScannedBlock[network.id]) {
                      lastScannedBlock[network.id] = currentBlock - 5n; // Start 5 blocks back
                  }

                  const startBlock = lastScannedBlock[network.id] + 1n;
                  
                  // Limit scan range to avoid RPC limits
                  const endBlock = startBlock + 10n > currentBlock ? currentBlock : startBlock + 10n;

                  if (startBlock > endBlock) {
                      isScanning.current = false;
                      continue;
                  }

                  // Fetch blocks
                  // In a real app we might fetch in parallel or batches
                  // Simple: iterate
                  for (let i = startBlock; i <= endBlock; i++) {
                      const block = await client.getBlock({ 
                          blockNumber: i, 
                          includeTransactions: true 
                      });
                      
                      const relevantTxs: Transaction[] = [];

                      for (const tx of block.transactions) {
                          // Check if FROM is one of our facilitators
                          if (tx.from && trackedAddresses.has(tx.from.toLowerCase())) {
                              // Found a tx initiated by facilitator
                              // Get receipt to check logs for token transfers and gas usage
                              const receipt = await client.getTransactionReceipt({ hash: tx.hash });
                              const effectiveGasPrice = receipt.effectiveGasPrice ?? tx.gasPrice ?? 0n;
                              const gasCost = (receipt.gasUsed * effectiveGasPrice).toString();
                              
                              const tokensTransferred: TokenTransfer[] = [];

                              for (const log of receipt.logs) {
                                  try {
                                      // Try to decode as Transfer event
                                      const decoded = decodeEventLog({
                                          abi: [TRANSFER_EVENT],
                                          data: log.data,
                                          topics: log.topics
                                      });
                                      
                                      if (decoded.eventName === 'Transfer') {
                                          const tokenAddress = log.address.toLowerCase();
                                          
                                          // Fetch Metadata if unknown
                                          if (!tokenMetadata[tokenAddress]) {
                                              try {
                                                  // Best effort fetch
                                                  const [symbol, decimals] = await Promise.all([
                                                      client.readContract({ address: log.address, abi: [SYMBOL_ABI], functionName: 'symbol' }).catch(() => 'UNK'),
                                                      client.readContract({ address: log.address, abi: [DECIMALS_ABI], functionName: 'decimals' }).catch(() => 18),
                                                  ]);
                                                  
                                                  addTokenMetadata(tokenAddress, { 
                                                      symbol: symbol as string, 
                                                      decimals: Number(decimals) 
                                                  });
                                              } catch {
                                                  // ignore
                                              }
                                          }

                                          tokensTransferred.push({
                                              address: log.address,
                                              amount: decoded.args.value.toString(),
                                              to: decoded.args.to
                                          });
                                      }
                                  } catch {
                                      // Not a standard transfer event, ignore
                                  }
                              }

                              relevantTxs.push({
                                  hash: tx.hash,
                                  networkId: network.id,
                                  from: tx.from,
                                  to: tx.to,
                                  value: tx.value.toString(),
                                  gasCost,
                                  timestamp: Number(block.timestamp) * 1000,
                                  blockNumber: Number(block.number),
                                  tokensTransferred
                              });
                          }
                      }

                      if (relevantTxs.length > 0) {
                          addTransactions(relevantTxs);
                      }
                  }

                  lastScannedBlock[network.id] = endBlock;

              } catch (e) {
                  console.error(`Block scan failed for ${network.name}`, e);
              }
          }
          isScanning.current = false;
      };

      const interval = setInterval(scanBlocks, 4000); // Check for new blocks every 4s
      return () => clearInterval(interval);
  }, [networks, facilitators, addTransactions, tokenMetadata, addTokenMetadata]);

  return null; 
}
