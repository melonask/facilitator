import { useState, useMemo } from 'react';
import { useStore, type Transaction } from '@/store/useStore';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatEther } from 'viem';
import { HugeiconsIcon } from '@hugeicons/react';
import { Clock01Icon, Coins01Icon, Fire02Icon } from '@hugeicons/core-free-icons';
import { TransactionDetailsDialog } from '@/components/TransactionDetailsDialog';
import { Sparkline } from '@/components/ui/sparkline';
import { FileText, ArrowRight, Search, ChevronLeft, ChevronRight } from 'lucide-react';

const ITEMS_PER_PAGE = 25;

export function Transactions() {
  const { transactions, networks, tokenMetadata, facilitators } = useStore();
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [timeRange, setTimeRange] = useState('all');
  const [filterNetwork, setFilterNetwork] = useState<string | null>(null);
  const [filterFacilitator, setFilterFacilitator] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Time filtering
  const now = Date.now();
  let startTime = 0;
  switch (timeRange) {
    case '1h': startTime = now - 3600 * 1000; break;
    case '24h': startTime = now - 24 * 3600 * 1000; break;
    case '7d': startTime = now - 7 * 24 * 3600 * 1000; break;
    case '30d': startTime = now - 30 * 24 * 3600 * 1000; break;
    case 'all': startTime = 0; break;
  }

  // Filter and search transactions
  const filteredTxs = useMemo(() => {
    let txs = transactions.filter(t => t.timestamp >= startTime);

    if (filterNetwork) {
      txs = txs.filter(t => t.networkId === filterNetwork);
    }

    if (filterFacilitator) {
      txs = txs.filter(t => t.from.toLowerCase() === filterFacilitator.toLowerCase());
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      txs = txs.filter(t =>
        t.hash.toLowerCase().includes(query) ||
        t.from.toLowerCase().includes(query) ||
        (t.to && t.to.toLowerCase().includes(query))
      );
    }

    return txs.sort((a, b) => b.timestamp - a.timestamp);
  }, [transactions, startTime, filterNetwork, filterFacilitator, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(filteredTxs.length / ITEMS_PER_PAGE);
  const paginatedTxs = filteredTxs.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Stats for filtered transactions
  const stats = useMemo(() => {
    const totalValue = filteredTxs.reduce((sum, tx) => sum + BigInt(tx.value), 0n);
    const totalGas = filteredTxs.reduce((sum, tx) => sum + BigInt(tx.gasCost || 0), 0n);
    const totalTokens = filteredTxs.reduce((sum, tx) => sum + tx.tokensTransferred.length, 0);

    // Transactions per hour (recent data for sparkline)
    const hourlyData: number[] = [];
    const hoursToShow = 24;
    for (let i = hoursToShow - 1; i >= 0; i--) {
      const hourStart = now - (i + 1) * 3600 * 1000;
      const hourEnd = now - i * 3600 * 1000;
      const count = filteredTxs.filter(tx => tx.timestamp >= hourStart && tx.timestamp < hourEnd).length;
      hourlyData.push(count);
    }

    return { totalValue, totalGas, totalTokens, hourlyData };
  }, [filteredTxs, now]);

  const formatTxValue = (value: string) => {
    const val = BigInt(value);
    if (val === 0n) return '0';
    const formatted = formatEther(val);
    return formatted.includes('.') ? formatted.replace(/0+$/, '').replace(/\.$/, '') : formatted;
  };

  const getCurrency = (tx: Transaction) => networks.find(n => n.id === tx.networkId)?.currency || 'ETH';
  const getNetworkName = (tx: Transaction) => networks.find(n => n.id === tx.networkId)?.name || 'Unknown';
  const getFacilitatorLabel = (address: string, networkId: string) => {
    const f = facilitators.find(f => f.id.toLowerCase() === address.toLowerCase() && f.networkId === networkId);
    return f?.label || address.slice(0, 10) + '...';
  };

  // Reset page when filters change
  const handleFilterChange = (setter: (v: string | null) => void, value: string | null) => {
    setter(value);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Transactions</h2>
          <p className="text-muted-foreground text-sm mt-1">
            {filteredTxs.length} transaction{filteredTxs.length !== 1 ? 's' : ''} found
          </p>
        </div>
        <Tabs value={timeRange} onValueChange={(v) => { setTimeRange(v); setCurrentPage(1); }}>
          <TabsList>
            <TabsTrigger value="1h">1H</TabsTrigger>
            <TabsTrigger value="24h">24H</TabsTrigger>
            <TabsTrigger value="7d">7D</TabsTrigger>
            <TabsTrigger value="30d">30D</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Transactions</p>
              <p className="text-2xl font-bold mt-1">{filteredTxs.length}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="p-2 bg-teal-500/10">
                <HugeiconsIcon icon={Coins01Icon} className="h-4 w-4 text-teal-500" />
              </div>
              {stats.hourlyData.length > 0 && (
                <Sparkline data={stats.hourlyData} width={50} height={16} color="#14b8a6" showArea />
              )}
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Total Value</p>
              <p className="text-2xl font-bold mt-1">{parseFloat(formatEther(stats.totalValue)).toFixed(4)}</p>
            </div>
            <div className="p-2 bg-teal-500/10">
              <HugeiconsIcon icon={Coins01Icon} className="h-4 w-4 text-teal-500" />
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Gas Spent</p>
              <p className="text-2xl font-bold mt-1">{parseFloat(formatEther(stats.totalGas)).toFixed(4)}</p>
            </div>
            <div className="p-2 bg-orange-500/10">
              <HugeiconsIcon icon={Fire02Icon} className="h-4 w-4 text-orange-500" />
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Token Transfers</p>
              <p className="text-2xl font-bold mt-1">{stats.totalTokens}</p>
            </div>
            <div className="p-2 bg-cyan-500/10">
              <HugeiconsIcon icon={Clock01Icon} className="h-4 w-4 text-cyan-500" />
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 sm:gap-4">
          {/* Search */}
          <div className="flex items-center gap-2 flex-1 min-w-0 sm:min-w-[200px] bg-muted/30 px-2 py-1.5 sm:bg-transparent sm:p-0">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              type="text"
              placeholder="Search by hash or address..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="flex-1 bg-transparent border-none focus:outline-none text-sm placeholder:text-muted-foreground min-w-0"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Network Filter */}
            <select
              className="text-sm bg-muted/50 border border-border px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring flex-1 sm:flex-none"
              value={filterNetwork || ''}
              onChange={(e) => handleFilterChange(setFilterNetwork, e.target.value || null)}
            >
              <option value="">All Networks</option>
              {networks.map(n => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>

            {/* Facilitator Filter */}
            <select
              className="text-sm bg-muted/50 border border-border px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring flex-1 sm:flex-none"
              value={filterFacilitator || ''}
              onChange={(e) => handleFilterChange(setFilterFacilitator, e.target.value || null)}
            >
              <option value="">All Facilitators</option>
              {facilitators.map(f => (
                <option key={`${f.networkId}:${f.id}`} value={f.id}>
                  {f.label || f.id.slice(0, 10) + '...'}
                </option>
              ))}
            </select>

            {/* Clear Filters */}
            {(searchQuery || filterNetwork || filterFacilitator) && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setFilterNetwork(null);
                  setFilterFacilitator(null);
                  setCurrentPage(1);
                }}
                className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {/* Header - Hidden on mobile */}
            <div className="hidden md:grid grid-cols-12 gap-4 p-3 text-xs font-medium text-muted-foreground bg-muted/30">
              <div className="col-span-3">Transaction</div>
              <div className="col-span-2">Facilitator</div>
              <div className="col-span-2">To</div>
              <div className="col-span-1 text-right">Value</div>
              <div className="col-span-1 text-right">Gas</div>
              <div className="col-span-2">Network</div>
              <div className="col-span-1 text-right">Time</div>
            </div>

            {/* Rows */}
            {paginatedTxs.length === 0 ? (
              <div className="text-center text-muted-foreground py-12">
                No transactions found.
              </div>
            ) : (
              paginatedTxs.map(tx => {
                const net = networks.find(n => n.id === tx.networkId);
                const val = formatTxValue(tx.value);
                const isZeroVal = BigInt(tx.value) === 0n;
                const gasVal = tx.gasCost ? parseFloat(formatEther(BigInt(tx.gasCost))).toFixed(6) : '-';

                return (
                  <div
                    key={tx.hash}
                    className="p-3 hover:bg-muted/40 transition-colors cursor-pointer text-sm"
                    onClick={() => setSelectedTx(tx)}
                  >
                    {/* Mobile Layout */}
                    <div className="md:hidden space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="p-1.5 bg-secondary text-secondary-foreground shrink-0">
                            <FileText size={12} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-mono text-xs font-medium truncate">{tx.hash.slice(0, 14)}...</p>
                            <p className="text-[10px] text-muted-foreground">Block {tx.blockNumber}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`font-mono text-xs font-medium ${isZeroVal ? 'text-muted-foreground' : ''}`}>
                            {val} {net?.currency}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {new Date(tx.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-muted-foreground truncate">{getFacilitatorLabel(tx.from, tx.networkId)}</span>
                          <ArrowRight size={10} className="text-muted-foreground shrink-0" />
                          <span className="font-mono truncate">{tx.to ? tx.to.slice(0, 8) + '...' : 'Contract'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant="outline" className="text-[10px] h-5">{net?.name}</Badge>
                          {tx.tokensTransferred.length > 0 && (
                            <Badge variant="secondary" className="text-[10px] h-5">+{tx.tokensTransferred.length}</Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Desktop Layout */}
                    <div className="hidden md:grid grid-cols-12 gap-4 items-center">
                      {/* Hash */}
                      <div className="col-span-3 flex items-center gap-2">
                        <div className="p-1.5 bg-secondary text-secondary-foreground">
                          <FileText size={12} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-medium truncate">{tx.hash.slice(0, 14)}...</p>
                          <p className="text-[10px] text-muted-foreground">Block {tx.blockNumber}</p>
                        </div>
                      </div>

                      {/* From */}
                      <div className="col-span-2">
                        <p className="font-mono text-xs truncate">{getFacilitatorLabel(tx.from, tx.networkId)}</p>
                      </div>

                      {/* To */}
                      <div className="col-span-2 flex items-center gap-1">
                        <ArrowRight size={10} className="text-muted-foreground shrink-0" />
                        <p className="font-mono text-xs truncate">{tx.to ? tx.to.slice(0, 10) + '...' : 'Contract'}</p>
                      </div>

                      {/* Value */}
                      <div className="col-span-1 text-right">
                        <p className={`font-mono text-xs font-medium ${isZeroVal ? 'text-muted-foreground' : ''}`}>
                          {val}
                        </p>
                      </div>

                      {/* Gas */}
                      <div className="col-span-1 text-right">
                        <p className="font-mono text-xs text-muted-foreground">{gasVal}</p>
                      </div>

                      {/* Network */}
                      <div className="col-span-2 flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] h-5 truncate">
                          {net?.name}
                        </Badge>
                        {tx.tokensTransferred.length > 0 && (
                          <Badge variant="secondary" className="text-[10px] h-5">
                            +{tx.tokensTransferred.length}
                          </Badge>
                        )}
                      </div>

                      {/* Time */}
                      <div className="col-span-1 text-right">
                        <p className="text-xs text-muted-foreground">
                          {new Date(tx.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(tx.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t bg-muted/30">
              <p className="text-xs text-muted-foreground">
                Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, filteredTxs.length)} of {filteredTxs.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm font-medium">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <TransactionDetailsDialog
        isOpen={!!selectedTx}
        transaction={selectedTx}
        onClose={() => setSelectedTx(null)}
        tokenMetadata={tokenMetadata}
        currency={selectedTx ? getCurrency(selectedTx) : 'ETH'}
        networkName={selectedTx ? getNetworkName(selectedTx) : 'Unknown'}
      />
    </div>
  );
}
