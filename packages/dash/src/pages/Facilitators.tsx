import { useMemo, useState } from 'react';
import { useStore } from '@/store/useStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Line } from 'recharts';
import { formatEther } from 'viem';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChartHistogramIcon, Alert01Icon, LockIcon, Coins01Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
import { CopyButton } from '@/components/CopyButton';
import { Sparkline, TrendIndicator } from '@/components/ui/sparkline';
import { MiniStat } from '@/components/ui/stat-card';
import { ProgressBar, HealthScore } from '@/components/ui/progress-bar';
import { Filter, Wallet, Activity, Fuel, TrendingUp, Clock } from 'lucide-react';

const NETWORK_COLORS = [
  '#14b8a6', '#f97316', '#22c55e', '#06b6d4',
  '#eab308', '#ec4899', '#6366f1', '#ef4444'
];

type SortOption = 'balance-desc' | 'balance-asc' | 'tx-desc' | 'tx-asc' | 'gas-desc' | 'name';

export function Facilitators() {
  const { facilitators, networks, stats, transactions } = useStore();
  const [sortBy, setSortBy] = useState<SortOption>('balance-desc');
  const [filterNetwork, setFilterNetwork] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'compact'>('grid');

  // Calculate gas spent per facilitator
  const gasSpentByFacilitator = useMemo(() => {
    const gasMap: Record<string, bigint> = {};
    transactions.forEach(tx => {
      if (tx.gasCost) {
        const key = `${tx.networkId}:${tx.from.toLowerCase()}`;
        gasMap[key] = (gasMap[key] || 0n) + BigInt(tx.gasCost);
      }
    });
    return gasMap;
  }, [transactions]);

  // Calculate token transfers per facilitator
  const tokenTransfersByFacilitator = useMemo(() => {
    const tokenMap: Record<string, number> = {};
    transactions.forEach(tx => {
      const key = `${tx.networkId}:${tx.from.toLowerCase()}`;
      tokenMap[key] = (tokenMap[key] || 0) + tx.tokensTransferred.length;
    });
    return tokenMap;
  }, [transactions]);

  // Max balance for progress bar
  const maxBalance = useMemo(() => {
    let max = 0;
    facilitators.forEach(f => {
      const key = `${f.networkId}:${f.id}`;
      const s = stats[key];
      if (s) {
        const bal = parseFloat(formatEther(BigInt(s.balance)));
        if (bal > max) max = bal;
      }
    });
    return max || 1;
  }, [facilitators, stats]);

  // Sort and filter facilitators
  const sortedFacilitators = useMemo(() => {
    let list = [...facilitators];

    if (filterNetwork) {
      list = list.filter(f => f.networkId === filterNetwork);
    }

    list.sort((a, b) => {
      const keyA = `${a.networkId}:${a.id}`;
      const keyB = `${b.networkId}:${b.id}`;
      const sA = stats[keyA];
      const sB = stats[keyB];
      const balA = sA ? parseFloat(formatEther(BigInt(sA.balance))) : 0;
      const balB = sB ? parseFloat(formatEther(BigInt(sB.balance))) : 0;
      const txA = sA?.txCount || 0;
      const txB = sB?.txCount || 0;
      const gasA = gasSpentByFacilitator[keyA] || 0n;
      const gasB = gasSpentByFacilitator[keyB] || 0n;

      switch (sortBy) {
        case 'balance-desc': return balB - balA;
        case 'balance-asc': return balA - balB;
        case 'tx-desc': return txB - txA;
        case 'tx-asc': return txA - txB;
        case 'gas-desc': return gasA > gasB ? -1 : gasA < gasB ? 1 : 0;
        case 'name': return (a.label || a.id).localeCompare(b.label || b.id);
        default: return 0;
      }
    });

    return list;
  }, [facilitators, stats, sortBy, filterNetwork, gasSpentByFacilitator]);

  const getNetworkColor = (networkId: string) => {
    const idx = networks.findIndex(n => n.id === networkId);
    return NETWORK_COLORS[idx % NETWORK_COLORS.length];
  };

  // Calculate health score for a facilitator
  const getFacilitatorHealth = (balance: number, txCount: number, balanceHistory: number[]) => {
    let score = 100;

    // Balance health (40% weight)
    if (balance < 0.01) score -= 40;
    else if (balance < 0.05) score -= 25;
    else if (balance < 0.1) score -= 15;

    // Balance trend (30% weight)
    if (balanceHistory.length >= 2) {
      const trend = (balanceHistory[balanceHistory.length - 1] - balanceHistory[0]) / (balanceHistory[0] || 1);
      if (trend < -0.5) score -= 30;
      else if (trend < -0.2) score -= 15;
    }

    // Activity (30% weight)
    if (txCount === 0) score -= 10;

    return Math.max(0, Math.min(100, score));
  };

  // Recent activity for each facilitator
  const recentActivityByFacilitator = useMemo(() => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const activityMap: Record<string, { count: number; lastTx: number | null }> = {};

    transactions.forEach(tx => {
      const key = `${tx.networkId}:${tx.from.toLowerCase()}`;
      if (!activityMap[key]) {
        activityMap[key] = { count: 0, lastTx: null };
      }
      if (tx.timestamp >= oneDayAgo) {
        activityMap[key].count++;
      }
      if (!activityMap[key].lastTx || tx.timestamp > activityMap[key].lastTx) {
        activityMap[key].lastTx = tx.timestamp;
      }
    });

    return activityMap;
  }, [transactions]);

  // Analytics Dialog Component - reused in both grid and compact views
  const renderAnalyticsDialog = (
    f: typeof facilitators[0],
    net: typeof networks[0] | undefined,
    key: string,
    balance: number,
    txCount: number,
    gasSpent: bigint,
    tokenCount: number,
    chartData: Array<{ timestamp: number; balanceEth: number; txCount: number }>,
    compact = false
  ) => (
    <Dialog>
      <DialogTrigger asChild>
        {compact ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 gap-1">
            <HugeiconsIcon icon={ChartHistogramIcon} className="h-3.5 w-3.5" strokeWidth={2} />
            <span className="hidden sm:inline text-xs">Analytics</span>
          </Button>
        ) : (
          <Button variant="outline" className="w-full mt-3 gap-2">
            <HugeiconsIcon icon={ChartHistogramIcon} className="h-4 w-4" strokeWidth={2} /> View Analytics
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className="w-3 h-3 shrink-0"
              style={{ backgroundColor: getNetworkColor(f.networkId) }}
            />
            <span className="truncate">{f.label || f.id.slice(0, 12) + '...'}</span>
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 flex-wrap">
            <span>{net?.name}</span>
            <span className="text-muted-foreground">|</span>
            <span className="font-mono text-xs truncate max-w-[180px] sm:max-w-[280px]">{f.id}</span>
            <CopyButton text={f.id} />
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Stats Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Card className="p-2 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Balance</p>
              <p className="text-lg font-bold">{balance.toFixed(4)}</p>
              <p className="text-[10px] text-muted-foreground">{net?.currency}</p>
            </Card>
            <Card className="p-2 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Transactions</p>
              <p className="text-lg font-bold">{txCount}</p>
              <p className="text-[10px] text-muted-foreground">total</p>
            </Card>
            <Card className="p-2 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Gas Spent</p>
              <p className="text-lg font-bold">{parseFloat(formatEther(gasSpent)).toFixed(4)}</p>
              <p className="text-[10px] text-muted-foreground">{net?.currency}</p>
            </Card>
            <Card className="p-2 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Tokens</p>
              <p className="text-lg font-bold">{tokenCount}</p>
              <p className="text-[10px] text-muted-foreground">transfers</p>
            </Card>
          </div>

          {/* Chart */}
          {chartData.length > 1 ? (
            <div>
              <h4 className="mb-2 text-sm font-medium flex items-center gap-2">
                <div className="p-1 bg-teal-500/10">
                  <Wallet className="h-3.5 w-3.5 text-teal-500" />
                </div>
                Balance & Transactions Over Time
              </h4>
              <div className="h-[180px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ left: -10, right: -10 }}>
                    <defs>
                      <linearGradient id={`colorBal-${key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={getNetworkColor(f.networkId)} stopOpacity={0.5} />
                        <stop offset="50%" stopColor={getNetworkColor(f.networkId)} stopOpacity={0.2} />
                        <stop offset="100%" stopColor={getNetworkColor(f.networkId)} stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}
                      stroke="var(--muted-foreground)"
                      fontSize={10}
                      minTickGap={40}
                    />
                    <YAxis
                      yAxisId="left"
                      stroke={getNetworkColor(f.networkId)}
                      fontSize={10}
                      domain={['auto', 'auto']}
                      tickFormatter={(v) => v.toFixed(2)}
                      width={45}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="var(--chart-2)"
                      fontSize={10}
                      domain={['dataMin', 'dataMax']}
                      width={35}
                    />
                    <Tooltip
                      labelFormatter={(ts) => new Date(ts).toLocaleString([], { hour12: false })}
                      formatter={(value: number, name: string) => {
                        if (name === 'balanceEth') return [value.toFixed(6), `Balance (${net?.currency})`];
                        return [value, 'Tx Count'];
                      }}
                      contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', fontSize: '12px' }}
                    />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="balanceEth"
                      stroke={getNetworkColor(f.networkId)}
                      fillOpacity={1}
                      fill={`url(#colorBal-${key})`}
                    />
                    <Line
                      yAxisId="right"
                      type="step"
                      dataKey="txCount"
                      stroke="#f97316"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="flex h-24 items-center justify-center text-muted-foreground border border-dashed text-sm">
              Collecting data... wait for updates.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="space-y-6">
      {/* Header with filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Facilitators</h2>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            {facilitators.length} facilitator{facilitators.length !== 1 ? 's' : ''} across {networks.length} network{networks.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Network Filter */}
          <div className="flex items-center gap-1">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              className="text-sm bg-transparent border-none focus:outline-none cursor-pointer text-muted-foreground"
              value={filterNetwork || ''}
              onChange={(e) => setFilterNetwork(e.target.value || null)}
            >
              <option value="">All Networks</option>
              {networks.map(n => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </div>

          {/* Sort */}
          <select
            className="text-sm bg-muted/50 border border-border  px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
          >
            <option value="balance-desc">Balance (High-Low)</option>
            <option value="balance-asc">Balance (Low-High)</option>
            <option value="tx-desc">Transactions (Most)</option>
            <option value="tx-asc">Transactions (Least)</option>
            <option value="gas-desc">Gas Spent (Most)</option>
            <option value="name">Name</option>
          </select>

          {/* View Toggle */}
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'grid' | 'compact')}>
            <TabsList className="h-8">
              <TabsTrigger value="grid" className="text-xs px-2">Grid</TabsTrigger>
              <TabsTrigger value="compact" className="text-xs px-2">Compact</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-teal-500/10">
              <Wallet className="h-4 w-4 text-teal-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Balance</p>
              <p className="text-lg font-bold">
                {facilitators.reduce((sum, f) => {
                  const key = `${f.networkId}:${f.id}`;
                  const s = stats[key];
                  return sum + (s ? parseFloat(formatEther(BigInt(s.balance))) : 0);
                }, 0).toFixed(4)}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-cyan-500/10">
              <Activity className="h-4 w-4 text-cyan-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Txs</p>
              <p className="text-lg font-bold">
                {facilitators.reduce((sum, f) => {
                  const key = `${f.networkId}:${f.id}`;
                  const s = stats[key];
                  return sum + (s?.txCount || 0);
                }, 0)}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-orange-500/10">
              <Fuel className="h-4 w-4 text-orange-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Gas</p>
              <p className="text-lg font-bold">
                {parseFloat(formatEther(
                  Object.values(gasSpentByFacilitator).reduce((sum, g) => sum + g, 0n)
                )).toFixed(4)}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-500/10">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-4 w-4 text-emerald-500" strokeWidth={2} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Healthy</p>
              <p className="text-lg font-bold">
                {facilitators.filter(f => {
                  const key = `${f.networkId}:${f.id}`;
                  const s = stats[key];
                  const balance = s ? parseFloat(formatEther(BigInt(s.balance))) : 0;
                  const history = s?.history?.slice(-20).map(h => parseFloat(formatEther(BigInt(h.balance)))) || [];
                  return getFacilitatorHealth(balance, s?.txCount || 0, history) >= 70;
                }).length}
                <span className="text-xs text-muted-foreground font-normal ml-1">/ {facilitators.length}</span>
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-red-500/10">
              <HugeiconsIcon icon={Alert01Icon} className="h-4 w-4 text-red-500" strokeWidth={2} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Need Attention</p>
              <p className="text-lg font-bold">
                {facilitators.filter(f => {
                  const key = `${f.networkId}:${f.id}`;
                  const s = stats[key];
                  return s && parseFloat(formatEther(BigInt(s.balance))) < 0.1;
                }).length}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Facilitator Cards */}
      {viewMode === 'grid' ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sortedFacilitators.map(f => {
            const net = networks.find(n => n.id === f.networkId);
            const key = `${f.networkId}:${f.id}`;
            const s = stats[key];
            const balance = s ? parseFloat(formatEther(BigInt(s.balance))) : 0;
            const txCount = s ? s.txCount : 0;
            const isLowBalance = balance < 0.1;
            const gasSpent = gasSpentByFacilitator[key] || 0n;
            const tokenCount = tokenTransfersByFacilitator[key] || 0;

            const balanceHistory = s?.history?.slice(-30).map(h => parseFloat(formatEther(BigInt(h.balance)))) || [];

            // Calculate balance trend
            const balanceTrend = balanceHistory.length >= 2
              ? ((balanceHistory[balanceHistory.length - 1] - balanceHistory[0]) / (balanceHistory[0] || 1)) * 100
              : 0;

            const chartData = s?.history?.map(h => ({
              timestamp: h.timestamp,
              balanceEth: parseFloat(formatEther(BigInt(h.balance))),
              txCount: Number(h.txCount)
            })) || [];

            // Health score and recent activity
            const healthScore = getFacilitatorHealth(balance, txCount, balanceHistory);
            const activity = recentActivityByFacilitator[key];
            const recentTxCount = activity?.count || 0;
            const lastTxTime = activity?.lastTx;

            const formatLastActive = (timestamp: number | null) => {
              if (!timestamp) return 'Never';
              const diff = Date.now() - timestamp;
              if (diff < 60000) return 'Just now';
              if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
              if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
              return `${Math.floor(diff / 86400000)}d ago`;
            };

            return (
              <Card key={key} className={`overflow-hidden transition-all hover:shadow-sm ${isLowBalance ? 'border-destructive/50' : ''}`}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <div className="space-y-1 overflow-hidden w-full">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 shrink-0"
                        style={{ backgroundColor: getNetworkColor(f.networkId) }}
                      />
                      <CardTitle className="text-base font-medium truncate max-w-[120px]" title={f.label || f.id}>
                        {f.label || f.id.slice(0, 8) + '...'}
                      </CardTitle>
                      {f.privateKey && (
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 font-normal text-muted-foreground shrink-0">
                          <HugeiconsIcon icon={LockIcon} className="h-3 w-3" strokeWidth={2} /> Key
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                      <span className="truncate">{f.id.slice(0, 10)}...</span>
                      <CopyButton text={f.id} />
                    </div>
                  </div>
                  <HealthScore score={healthScore} size="sm" />
                </CardHeader>
                <CardContent>
                  {/* Main stats */}
                  <div className="space-y-3">
                    {/* Balance with progress bar */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Balance</span>
                        <div className="flex items-center gap-1">
                          <span className={`font-mono text-sm font-semibold ${isLowBalance ? 'text-destructive' : ''}`}>
                            {balance.toFixed(4)} {net?.currency}
                          </span>
                          {balanceTrend !== 0 && (
                            <TrendIndicator value={balanceTrend} className="ml-1" />
                          )}
                        </div>
                      </div>
                      <ProgressBar
                        value={balance}
                        max={maxBalance}
                        size="sm"
                        color={isLowBalance ? 'var(--destructive)' : getNetworkColor(f.networkId)}
                      />
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <MiniStat label="Network" value={net?.name || 'Unknown'} />
                      <MiniStat label="Transactions" value={txCount.toLocaleString()} />
                      <MiniStat label="Gas Spent" value={`${parseFloat(formatEther(gasSpent)).toFixed(4)}`} />
                    </div>

                    {/* Activity row */}
                    <div className="flex items-center justify-between pt-2 mt-2 border-t">
                      <div className="flex items-center gap-3">
                        {tokenCount > 0 && (
                          <Badge variant="secondary" className="text-[10px] h-5">
                            <HugeiconsIcon icon={Coins01Icon} className="h-3 w-3 mr-1" strokeWidth={2} />
                            {tokenCount} tokens
                          </Badge>
                        )}
                        {recentTxCount > 0 && (
                          <Badge variant="outline" className="text-[10px] h-5">
                            <TrendingUp className="h-3 w-3 mr-1" />
                            {recentTxCount} today
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatLastActive(lastTxTime)}
                      </div>
                    </div>

                    {/* Sparkline */}
                    {balanceHistory.length > 1 && (
                      <div className="pt-2 mt-2 border-t">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-muted-foreground">Balance trend</span>
                          {balanceTrend !== 0 && <TrendIndicator value={balanceTrend} className="text-[10px]" />}
                        </div>
                        <Sparkline data={balanceHistory} width={200} height={24} color="auto" showArea />
                      </div>
                    )}
                  </div>

                  {/* Analytics Dialog */}
                  {renderAnalyticsDialog(f, net, key, balance, txCount, gasSpent, tokenCount, chartData)}
                </CardContent>
              </Card>
            )
          })}
          {sortedFacilitators.length === 0 && (
            <div className="col-span-full text-center text-muted-foreground py-12">
              {filterNetwork ? 'No facilitators on this network.' : 'No facilitators configured. Go to Settings to add one.'}
            </div>
          )}
        </div>
      ) : (
        /* Compact View */
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {sortedFacilitators.map(f => {
                const net = networks.find(n => n.id === f.networkId);
                const key = `${f.networkId}:${f.id}`;
                const s = stats[key];
                const balance = s ? parseFloat(formatEther(BigInt(s.balance))) : 0;
                const txCount = s ? s.txCount : 0;
                const isLowBalance = balance < 0.1;
                const gasSpent = gasSpentByFacilitator[key] || 0n;
                const tokenCount = tokenTransfersByFacilitator[key] || 0;
                const balanceHistory = s?.history?.slice(-20).map(h => parseFloat(formatEther(BigInt(h.balance)))) || [];
                const chartData = s?.history?.map(h => ({
                  timestamp: h.timestamp,
                  balanceEth: parseFloat(formatEther(BigInt(h.balance))),
                  txCount: Number(h.txCount)
                })) || [];

                return (
                  <div
                    key={key}
                    className={`flex items-center gap-2 sm:gap-4 p-3 hover:bg-muted/40 transition-colors ${isLowBalance ? 'bg-destructive/5' : ''}`}
                  >
                    <span
                      className="w-2.5 h-2.5 shrink-0"
                      style={{ backgroundColor: getNetworkColor(f.networkId) }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{f.label || f.id.slice(0, 10) + '...'}</span>
                        <Badge variant="outline" className="text-[10px] h-4 hidden sm:inline-flex">{net?.name}</Badge>
                        {f.privateKey && (
                          <HugeiconsIcon icon={LockIcon} className="h-3 w-3 text-muted-foreground hidden sm:block" strokeWidth={2} />
                        )}
                      </div>
                      <p className="text-xs font-mono text-muted-foreground truncate hidden sm:block">{f.id}</p>
                    </div>
                    <div className="hidden md:flex items-center gap-4">
                      {balanceHistory.length > 1 && (
                        <Sparkline data={balanceHistory} width={60} height={20} color="auto" showArea />
                      )}
                    </div>
                    <div className="flex items-center gap-3 sm:gap-6 text-right">
                      <div>
                        <p className="text-[10px] sm:text-xs text-muted-foreground">Balance</p>
                        <p className={`text-xs sm:text-sm font-mono font-semibold ${isLowBalance ? 'text-destructive' : ''}`}>
                          {balance.toFixed(4)}
                        </p>
                      </div>
                      <div className="hidden sm:block">
                        <p className="text-xs text-muted-foreground">Txs</p>
                        <p className="text-sm font-mono font-semibold">{txCount}</p>
                      </div>
                      <div className="hidden lg:block">
                        <p className="text-xs text-muted-foreground">Gas</p>
                        <p className="text-sm font-mono font-semibold">{parseFloat(formatEther(gasSpent)).toFixed(4)}</p>
                      </div>
                      {isLowBalance && (
                        <HugeiconsIcon icon={Alert01Icon} className="text-destructive h-4 w-4 shrink-0" strokeWidth={2} />
                      )}
                      {renderAnalyticsDialog(f, net, key, balance, txCount, gasSpent, tokenCount, chartData, true)}
                    </div>
                  </div>
                );
              })}
              {sortedFacilitators.length === 0 && (
                <div className="text-center text-muted-foreground py-12">
                  {filterNetwork ? 'No facilitators on this network.' : 'No facilitators configured.'}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
