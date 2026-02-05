import { useState, useMemo } from 'react';
import { useStore, type Transaction } from '@/store/useStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard, NetworkStatRow } from '@/components/ui/stat-card';
import { StackedBar, ActivityHeatmap, HealthScore } from '@/components/ui/progress-bar';
import { Sparkline } from '@/components/ui/sparkline';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Activity01Icon, Coins01Icon, Alert01Icon, ComputerIcon,
  ChartLineData01Icon, Clock01Icon, Analytics01Icon, StarIcon,
  Rocket01Icon, Fire02Icon, CoinsDollarIcon
} from '@hugeicons/core-free-icons';
import { formatEther, formatGwei } from 'viem';
import {
  BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, ComposedChart, Line
} from 'recharts';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { TransactionDetailsDialog } from '@/components/TransactionDetailsDialog';
import { FileText, ArrowRight, Zap, TrendingUp, Wallet, Globe } from 'lucide-react';

const NETWORK_COLORS = [
  '#14b8a6', '#f97316', '#22c55e', '#06b6d4',
  '#eab308', '#ec4899', '#6366f1', '#ef4444'
];

export function Overview() {
  const { facilitators, networks, stats, transactions, tokenMetadata, gasPrices } = useStore();
  const [timeRange, setTimeRange] = useState('24h');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);

  // Compute metrics
  const metrics = useMemo(() => {
    let totalBalance = 0n;
    let totalTxCount = 0;
    let lowBalanceCount = 0;
    let totalGasSpent = 0n;
    const balanceByNetwork: Record<string, bigint> = {};
    const txCountByNetwork: Record<string, number> = {};
    const gasSpentByNetwork: Record<string, bigint> = {};
    const facilitatorBalances: Array<{ key: string; balance: number; history: number[] }> = [];

    facilitators.forEach(f => {
      const key = `${f.networkId}:${f.id.toLowerCase()}`;
      const s = stats[key];
      if (s) {
        const bal = BigInt(s.balance);
        totalBalance += bal;
        totalTxCount += s.txCount;

        const balEth = parseFloat(formatEther(bal));
        if (balEth < 0.1) lowBalanceCount++;

        balanceByNetwork[f.networkId] = (balanceByNetwork[f.networkId] || 0n) + bal;
        txCountByNetwork[f.networkId] = (txCountByNetwork[f.networkId] || 0) + s.txCount;

        // Get balance history for sparkline
        const historyValues = s.history.slice(-20).map(h => parseFloat(formatEther(BigInt(h.balance))));
        facilitatorBalances.push({ key, balance: balEth, history: historyValues });
      }
    });

    // Calculate total gas spent from transactions
    transactions.forEach(tx => {
      if (tx.gasCost) {
        const gasCost = BigInt(tx.gasCost);
        totalGasSpent += gasCost;
        gasSpentByNetwork[tx.networkId] = (gasSpentByNetwork[tx.networkId] || 0n) + gasCost;
      }
    });

    return {
      totalBalance,
      totalTxCount,
      lowBalanceCount,
      totalGasSpent,
      balanceByNetwork,
      txCountByNetwork,
      gasSpentByNetwork,
      facilitatorBalances,
    };
  }, [facilitators, stats, transactions]);

  // Time Filtering
  const now = Date.now();
  let startTime = 0;
  switch (timeRange) {
    case '1h': startTime = now - 3600 * 1000; break;
    case '24h': startTime = now - 24 * 3600 * 1000; break;
    case '7d': startTime = now - 7 * 24 * 3600 * 1000; break;
    case '30d': startTime = now - 30 * 24 * 3600 * 1000; break;
    case 'all': startTime = 0; break;
  }

  const filteredTxs = useMemo(() => {
    let txs = transactions.filter(t => t.timestamp >= startTime);
    if (selectedNetwork) {
      txs = txs.filter(t => t.networkId === selectedNetwork);
    }
    return txs;
  }, [transactions, startTime, selectedNetwork]);

  // Period metrics for comparison (previous period)
  const previousPeriodTxs = useMemo(() => {
    const periodLength = now - startTime;
    const prevStart = startTime - periodLength;
    let txs = transactions.filter(t => t.timestamp >= prevStart && t.timestamp < startTime);
    if (selectedNetwork) {
      txs = txs.filter(t => t.networkId === selectedNetwork);
    }
    return txs;
  }, [transactions, startTime, now, selectedNetwork]);

  const txCountTrend = useMemo(() => {
    if (previousPeriodTxs.length === 0) return filteredTxs.length > 0 ? 100 : 0;
    return ((filteredTxs.length - previousPeriodTxs.length) / previousPeriodTxs.length) * 100;
  }, [filteredTxs, previousPeriodTxs]);

  const gasSpentInPeriod = useMemo(() => {
    return filteredTxs.reduce((sum, tx) => sum + BigInt(tx.gasCost || 0), 0n);
  }, [filteredTxs]);

  const prevGasSpent = useMemo(() => {
    return previousPeriodTxs.reduce((sum, tx) => sum + BigInt(tx.gasCost || 0), 0n);
  }, [previousPeriodTxs]);

  const gasSpentTrend = useMemo(() => {
    if (prevGasSpent === 0n) return gasSpentInPeriod > 0n ? 100 : 0;
    return Number((gasSpentInPeriod - prevGasSpent) * 100n / prevGasSpent);
  }, [gasSpentInPeriod, prevGasSpent]);

  // Chart Data - Activity bucketed
  const chartData = useMemo(() => {
    let bucketSize = 60 * 1000;
    if (timeRange === '24h') bucketSize = 60 * 60 * 1000;
    else if (timeRange === '7d') bucketSize = 4 * 60 * 60 * 1000;
    else if (timeRange === '30d') bucketSize = 24 * 60 * 60 * 1000;
    else if (timeRange === 'all') bucketSize = 24 * 60 * 60 * 1000;

    const buckets: Record<number, { count: number; gasSpent: number; value: number }> = {};

    filteredTxs.forEach(tx => {
      const bucket = Math.floor(tx.timestamp / bucketSize) * bucketSize;
      if (!buckets[bucket]) {
        buckets[bucket] = { count: 0, gasSpent: 0, value: 0 };
      }
      buckets[bucket].count += 1;
      buckets[bucket].gasSpent += parseFloat(formatEther(BigInt(tx.gasCost || 0)));
      buckets[bucket].value += parseFloat(formatEther(BigInt(tx.value)));
    });

    return Object.entries(buckets)
      .map(([ts, data]) => ({
        timestamp: Number(ts),
        count: data.count,
        gasSpent: data.gasSpent,
        value: data.value,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [filteredTxs, timeRange]);

  // Token Stats
  const tokenStats = useMemo(() => {
    const tokenCounts: Record<string, { count: number; volume: bigint }> = {};

    filteredTxs.forEach(tx => {
      tx.tokensTransferred.forEach(token => {
        const key = token.address.toLowerCase();
        if (!tokenCounts[key]) {
          tokenCounts[key] = { count: 0, volume: 0n };
        }
        tokenCounts[key].count += 1;
        tokenCounts[key].volume += BigInt(token.amount);
      });
    });

    return Object.entries(tokenCounts)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 5)
      .map(([addr, data]) => ({
        name: tokenMetadata[addr]?.symbol || addr.slice(0, 6),
        count: data.count,
        volume: data.volume,
        decimals: tokenMetadata[addr]?.decimals || 18,
        address: addr,
      }));
  }, [filteredTxs, tokenMetadata]);

  // Destination Stats
  const destinationStats = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredTxs.forEach(tx => {
      if (tx.to) {
        counts[tx.to] = (counts[tx.to] || 0) + 1;
      }
    });

    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([addr, count]) => ({
        name: addr.slice(0, 8) + '...',
        count,
        address: addr,
      }));
  }, [filteredTxs]);

  // Network distribution for stacked bar
  const networkDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredTxs.forEach(tx => {
      counts[tx.networkId] = (counts[tx.networkId] || 0) + 1;
    });

    return networks.map((n, i) => ({
      value: counts[n.id] || 0,
      color: NETWORK_COLORS[i % NETWORK_COLORS.length],
      label: n.name,
      id: n.id,
    }));
  }, [filteredTxs, networks]);

  const tooltipStyles = {
    contentStyle: {
      backgroundColor: 'var(--card)',
      borderColor: 'var(--border)',
      borderRadius: 'var(--radius)',
      color: 'var(--foreground)',
    },
    itemStyle: { color: 'var(--foreground)' },
  };

  const PIE_COLORS = ['#14b8a6', '#f97316', '#22c55e', '#06b6d4', '#eab308'];

  const formatTxValue = (value: string) => {
    const val = BigInt(value);
    if (val === 0n) return '0';
    const formatted = formatEther(val);
    return formatted.includes('.') ? formatted.replace(/0+$/, '').replace(/\.$/, '') : formatted;
  };

  const getCurrency = (tx: Transaction) => networks.find(n => n.id === tx.networkId)?.currency || 'ETH';
  const getNetworkName = (tx: Transaction) => networks.find(n => n.id === tx.networkId)?.name || 'Unknown Network';

  const formatCompact = (value: number) => {
    if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
    if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
    return value.toFixed(2);
  };

  // Total token transfers in period
  const totalTokenTransfers = filteredTxs.reduce((sum, tx) => sum + tx.tokensTransferred.length, 0);

  // Hourly transaction data for sparkline
  const hourlyTxData = useMemo(() => {
    const hourlyBuckets: number[] = [];
    for (let i = 23; i >= 0; i--) {
      const hourStart = now - (i + 1) * 3600 * 1000;
      const hourEnd = now - i * 3600 * 1000;
      const count = filteredTxs.filter(tx => tx.timestamp >= hourStart && tx.timestamp < hourEnd).length;
      hourlyBuckets.push(count);
    }
    return hourlyBuckets;
  }, [filteredTxs, now]);

  // Activity heatmap data (last 7 days)
  const activityHeatmapData = useMemo(() => {
    const data: Array<{ hour: number; day: number; value: number }> = [];
    const nowDate = new Date();

    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const dayOffset = (nowDate.getDay() - d + 7) % 7;
        const dayStart = new Date(nowDate);
        dayStart.setDate(dayStart.getDate() - d);
        dayStart.setHours(h, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(h + 1, 0, 0, 0);

        const count = transactions.filter(tx =>
          tx.timestamp >= dayStart.getTime() && tx.timestamp < dayEnd.getTime()
        ).length;

        data.push({ day: dayOffset, hour: h, value: count });
      }
    }
    return data;
  }, [transactions]);

  // System health score
  const healthScore = useMemo(() => {
    let score = 100;
    // Deduct for low balance facilitators
    score -= metrics.lowBalanceCount * 15;
    // Deduct if no recent transactions
    if (filteredTxs.length === 0 && timeRange !== 'all') score -= 20;
    // Deduct for high gas spending trend
    if (gasSpentTrend > 50) score -= 10;
    return Math.max(0, Math.min(100, score));
  }, [metrics.lowBalanceCount, filteredTxs.length, timeRange, gasSpentTrend]);

  // Average gas per transaction
  const avgGasPerTx = useMemo(() => {
    if (filteredTxs.length === 0) return 0n;
    return gasSpentInPeriod / BigInt(filteredTxs.length);
  }, [gasSpentInPeriod, filteredTxs.length]);

  // Peak activity hour
  const peakHour = useMemo(() => {
    const hourCounts: Record<number, number> = {};
    filteredTxs.forEach(tx => {
      const hour = new Date(tx.timestamp).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    let maxHour = 0;
    let maxCount = 0;
    Object.entries(hourCounts).forEach(([h, count]) => {
      if (count > maxCount) {
        maxCount = count;
        maxHour = parseInt(h);
      }
    });
    return { hour: maxHour, count: maxCount };
  }, [filteredTxs]);

  return (
    <div className="space-y-6">
      {/* Header with Time Filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Overview</h2>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            Monitor your facilitators across {networks.length} network{networks.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {selectedNetwork && (
            <Badge
              variant="secondary"
              className="cursor-pointer gap-1.5"
              onClick={() => setSelectedNetwork(null)}
            >
              {networks.find(n => n.id === selectedNetwork)?.name}
              <span className="text-muted-foreground">&times;</span>
            </Badge>
          )}
          <Tabs value={timeRange} onValueChange={setTimeRange} className="w-auto">
            <TabsList>
              <TabsTrigger value="1h">1H</TabsTrigger>
              <TabsTrigger value="24h">24H</TabsTrigger>
              <TabsTrigger value="7d">7D</TabsTrigger>
              <TabsTrigger value="30d">30D</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Main KPI Cards with Health Score */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {/* Health Score Card */}
        <Card className="p-4 flex flex-col items-center justify-center lg:row-span-2">
          <p className="text-sm font-medium text-muted-foreground mb-3">System Health</p>
          <HealthScore score={healthScore} size="lg" />
          <div className="mt-3 text-center">
            <p className="text-xs text-muted-foreground">
              {metrics.lowBalanceCount > 0 ? `${metrics.lowBalanceCount} low balance` : 'All systems normal'}
            </p>
          </div>
        </Card>

        <StatCard
          title="Facilitators"
          value={facilitators.length}
          subtitle={`${metrics.lowBalanceCount} need attention`}
          icon={<HugeiconsIcon icon={Activity01Icon} className="h-4 w-4" strokeWidth={2} />}
          iconClassName="p-2 bg-teal-500/10 text-teal-500"
          sparklineData={metrics.facilitatorBalances.slice(0, 10).map(f => f.balance)}
        />

        <StatCard
          title="Total Balance"
          value={`${formatCompact(parseFloat(formatEther(metrics.totalBalance)))}`}
          subtitle={networks[0]?.currency || 'ETH'}
          icon={<Wallet className="h-4 w-4" />}
          iconClassName="p-2 bg-teal-500/10 text-teal-500"
          comparison={{ value: `${networks.length} networks`, label: 'Across' }}
        />

        <StatCard
          title="Transactions"
          value={filteredTxs.length}
          subtitle={timeRange === 'all' ? 'All time' : `Last ${timeRange}`}
          trend={txCountTrend}
          icon={<HugeiconsIcon icon={Coins01Icon} className="h-4 w-4" strokeWidth={2} />}
          iconClassName="p-2 bg-cyan-500/10 text-cyan-500"
          sparklineData={hourlyTxData}
        />

        <StatCard
          title="Gas Spent"
          value={formatCompact(parseFloat(formatEther(gasSpentInPeriod)))}
          subtitle={networks[0]?.currency || 'ETH'}
          trend={gasSpentTrend}
          icon={<HugeiconsIcon icon={Fire02Icon} className="h-4 w-4" strokeWidth={2} />}
          iconClassName="p-2 bg-orange-500/10 text-orange-500"
          comparison={{ value: `${parseFloat(formatEther(avgGasPerTx)).toFixed(6)} avg/tx`, label: '' }}
        />

        <StatCard
          title="Token Transfers"
          value={totalTokenTransfers}
          subtitle={`${tokenStats.length} unique tokens`}
          icon={<HugeiconsIcon icon={CoinsDollarIcon} className="h-4 w-4" strokeWidth={2} />}
          iconClassName="p-2 bg-pink-500/10 text-pink-500"
        />

        <StatCard
          title="Avg Gas Price"
          value={networks.length > 0 && Object.values(gasPrices).length > 0
            ? `${(Object.values(gasPrices).reduce((sum, p) => sum + parseFloat(formatGwei(BigInt(p))), 0) / Object.values(gasPrices).length).toFixed(1)}`
            : '--'}
          subtitle="Gwei"
          icon={<Zap className="h-4 w-4" />}
          iconClassName="p-2 bg-yellow-500/10 text-yellow-500"
        />

        <StatCard
          title="Avg Tx Value"
          value={filteredTxs.length > 0
            ? formatCompact(filteredTxs.reduce((sum, tx) => sum + parseFloat(formatEther(BigInt(tx.value))), 0) / filteredTxs.length)
            : '0'}
          subtitle={networks[0]?.currency || 'ETH'}
          icon={<TrendingUp className="h-4 w-4" />}
          iconClassName="p-2 bg-emerald-500/10 text-emerald-500"
        />

        <StatCard
          title="Peak Hour"
          value={peakHour.count > 0 ? `${peakHour.hour.toString().padStart(2, '0')}:00` : '--'}
          subtitle={peakHour.count > 0 ? `${peakHour.count} transactions` : 'No data'}
          icon={<HugeiconsIcon icon={Clock01Icon} className="h-4 w-4" strokeWidth={2} />}
          iconClassName="p-2 bg-indigo-500/10 text-indigo-500"
        />
      </div>

      {/* Network Distribution & Activity Heatmap */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Network Distribution Bar */}
        {networks.length > 0 && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <div className="p-1.5 bg-cyan-500/10">
                  <Globe className="h-3.5 w-3.5 text-cyan-500" />
                </div>
                Network Distribution
              </h3>
              <span className="text-xs text-muted-foreground">{filteredTxs.length} transactions</span>
            </div>
            {networkDistribution.some(n => n.value > 0) ? (
              <>
                <StackedBar segments={networkDistribution} height={12} />
                <div className="flex flex-wrap gap-4 mt-3">
                  {networkDistribution.filter(n => n.value > 0).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => setSelectedNetwork(selectedNetwork === n.id ? null : n.id)}
                      className={`flex items-center gap-1.5 text-xs hover:opacity-80 transition-opacity ${
                        selectedNetwork === n.id ? 'ring-2 ring-primary ring-offset-2 ring-offset-background px-1' : ''
                      }`}
                    >
                      <span className="w-2.5 h-2.5" style={{ backgroundColor: n.color }} />
                      <span className="text-muted-foreground">{n.label}</span>
                      <span className="font-mono font-medium">{n.value}</span>
                      <span className="text-muted-foreground text-[10px]">
                        ({((n.value / filteredTxs.length) * 100).toFixed(0)}%)
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-24 text-muted-foreground text-sm border border-dashed">
                No transactions in this period
              </div>
            )}
          </Card>
        )}

        {/* Activity Heatmap */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <div className="p-1.5 bg-teal-500/10">
                <HugeiconsIcon icon={ChartLineData01Icon} className="h-3.5 w-3.5 text-teal-500" />
              </div>
              Weekly Activity
            </h3>
            <span className="text-xs text-muted-foreground">Last 7 days</span>
          </div>
          <ActivityHeatmap data={activityHeatmapData} />
        </Card>
      </div>

      {/* Main Charts Row */}
      <div className="grid gap-4 lg:grid-cols-7">
        {/* Transaction Activity Chart */}
        <Card className="lg:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="p-1.5 bg-teal-500/10">
                <HugeiconsIcon icon={ChartLineData01Icon} className="h-4 w-4 text-teal-500" />
              </div>
              Activity & Gas Spending
            </CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[280px] w-full">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <defs>
                      <linearGradient id="colorTxActivity" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.9} />
                        <stop offset="50%" stopColor="#14b8a6" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(ts) => {
                        const d = new Date(ts);
                        if (timeRange === '1h' || timeRange === '24h') {
                          return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' });
                        }
                        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
                      }}
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                      minTickGap={40}
                    />
                    <YAxis yAxisId="left" stroke="var(--muted-foreground)" fontSize={11} allowDecimals={false} />
                    <YAxis yAxisId="right" orientation="right" stroke="#f97316" fontSize={11} tickFormatter={(v) => v.toFixed(3)} />
                    <Tooltip
                      labelFormatter={(ts) => new Date(ts).toLocaleString([], { hour12: false })}
                      formatter={(value: number, name: string) => {
                        if (name === 'gasSpent') return [value.toFixed(6), 'Gas (ETH)'];
                        return [value, name === 'count' ? 'Transactions' : name];
                      }}
                      cursor={{ fill: 'var(--muted)', opacity: 0.1 }}
                      {...tooltipStyles}
                    />
                    <Bar yAxisId="left" dataKey="count" fill="url(#colorTxActivity)" radius={0} />
                    <Line yAxisId="right" type="monotone" dataKey="gasSpent" stroke="#f97316" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground border border-dashed ">
                  No transactions in this period.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top Token Transfers */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="p-1.5 bg-emerald-500/10">
                <HugeiconsIcon icon={Analytics01Icon} className="h-4 w-4 text-emerald-500" />
              </div>
              Top Tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full">
              {tokenStats.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={tokenStats}
                      cx="50%"
                      cy="45%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="count"
                    >
                      {tokenStats.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} strokeWidth={2} stroke="var(--card)" />
                      ))}
                    </Pie>
                    <Tooltip cursor={{ fill: 'transparent' }} {...tooltipStyles} />
                    <Legend layout="horizontal" verticalAlign="bottom" align="center" />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground border border-dashed ">
                  No token transfers.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Network Stats & Recent Activity Row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Per-Network Breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="p-1.5 bg-cyan-500/10">
                <HugeiconsIcon icon={ComputerIcon} className="h-4 w-4 text-cyan-500" />
              </div>
              Network Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {networks.length > 0 ? (
              networks.map((network, i) => {
                const netTxs = filteredTxs.filter(tx => tx.networkId === network.id);
                const netGas = netTxs.reduce((sum, tx) => sum + BigInt(tx.gasCost || 0), 0n);
                const netBalance = metrics.balanceByNetwork[network.id] || 0n;
                const facilitatorCount = facilitators.filter(f => f.networkId === network.id).length;

                return (
                  <NetworkStatRow
                    key={network.id}
                    name={network.name}
                    color={NETWORK_COLORS[i % NETWORK_COLORS.length]}
                    stats={[
                      { label: 'Facilitators', value: facilitatorCount },
                      { label: 'Txs', value: netTxs.length },
                      { label: 'Gas', value: `${parseFloat(formatEther(netGas)).toFixed(4)} ${network.currency}` },
                      { label: 'Balance', value: `${parseFloat(formatEther(netBalance)).toFixed(2)} ${network.currency}` },
                    ]}
                  />
                );
              })
            ) : (
              <div className="text-sm text-muted-foreground text-center py-4">
                No networks configured.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Destinations */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="p-1.5 bg-teal-500/10">
                <HugeiconsIcon icon={StarIcon} className="h-4 w-4 text-teal-500" />
              </div>
              Top Destinations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px] w-full">
              {destinationStats.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={destinationStats} layout="vertical">
                    <defs>
                      <linearGradient id="colorDestinations" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.3} />
                        <stop offset="50%" stopColor="#14b8a6" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.9} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="var(--border)" />
                    <XAxis type="number" stroke="var(--muted-foreground)" fontSize={11} />
                    <YAxis dataKey="name" type="category" stroke="var(--muted-foreground)" fontSize={11} width={80} />
                    <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.1 }} {...tooltipStyles} />
                    <Bar dataKey="count" fill="url(#colorDestinations)" radius={0} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground border border-dashed ">
                  No data yet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions & Gas Prices */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Recent Activity */}
        <Card className="md:col-span-2 lg:col-span-2 overflow-hidden flex flex-col max-h-[400px]">
          <CardHeader className="pb-2 shrink-0">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-base">
                <div className="p-1.5 bg-indigo-500/10">
                  <HugeiconsIcon icon={Clock01Icon} className="h-4 w-4 text-indigo-500" />
                </div>
                Recent Activity
              </span>
              <Badge variant="outline" className="font-mono text-xs">
                {filteredTxs.length} txs
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-0">
            <div className="divide-y">
              {filteredTxs.slice(0, 10).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No transactions found.</p>
              )}
              {filteredTxs
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 10)
                .map((tx) => {
                  const net = networks.find((n) => n.id === tx.networkId);
                  const val = formatTxValue(tx.value);
                  const isZeroVal = BigInt(tx.value) === 0n;
                  const gasVal = tx.gasCost ? parseFloat(formatEther(BigInt(tx.gasCost))).toFixed(6) : '-';

                  return (
                    <div
                      key={tx.hash}
                      className="flex items-center justify-between gap-2 p-3 hover:bg-muted/40 transition-colors cursor-pointer group"
                      onClick={() => setSelectedTx(tx)}
                    >
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                        <div className="p-1.5 sm:p-2 bg-secondary text-secondary-foreground shrink-0">
                          <FileText size={14} />
                        </div>
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-medium text-foreground truncate">
                              {tx.hash.slice(0, 10)}...
                            </span>
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 hidden sm:inline-flex">
                              {net?.name}
                            </Badge>
                          </div>
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                            {new Date(tx.timestamp).toLocaleTimeString([], { hour12: false })}
                            <ArrowRight size={10} className="shrink-0" />
                            <span className="font-mono truncate">{tx.to ? tx.to.slice(0, 8) + '...' : 'Contract'}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex flex-col gap-0.5 shrink-0">
                        <div className={`text-xs font-mono font-medium ${isZeroVal ? 'text-muted-foreground' : 'text-foreground'}`}>
                          {val} <span className="hidden sm:inline">{net?.currency}</span>
                        </div>
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-[10px] text-muted-foreground hidden sm:inline">
                            Gas: {gasVal}
                          </span>
                          {tx.tokensTransferred.length > 0 && (
                            <span className="text-[10px] text-primary bg-primary/5 px-1.5 py-0.5">
                              +{tx.tokensTransferred.length}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>

        {/* Gas Prices Panel */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="p-1.5 bg-orange-500/10">
                <HugeiconsIcon icon={Rocket01Icon} className="h-4 w-4 text-orange-500" />
              </div>
              Gas Prices
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {networks.map((n, i) => {
              const gasPrice = gasPrices[n.id];
              const gweiPrice = gasPrice ? parseFloat(formatGwei(BigInt(gasPrice))) : 0;

              return (
                <div key={n.id} className="flex items-center gap-3 p-2  bg-muted/30">
                  <span
                    className="w-2.5 h-2.5  shrink-0"
                    style={{ backgroundColor: NETWORK_COLORS[i % NETWORK_COLORS.length] }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{n.name}</p>
                    <p className="text-[10px] text-muted-foreground">{n.currency}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono font-semibold">
                      {gasPrice ? `${gweiPrice.toFixed(2)}` : '--'}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Gwei</p>
                  </div>
                </div>
              );
            })}
            {networks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No networks</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Low Balance Warnings */}
      {metrics.lowBalanceCount > 0 && (
        <Card className="border-destructive/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-destructive flex items-center gap-2 text-base">
              <div className="p-1.5 bg-destructive/10">
                <HugeiconsIcon icon={Alert01Icon} className="h-4 w-4" strokeWidth={2} />
              </div>
              Low Balance Warnings ({metrics.lowBalanceCount})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {facilitators.map((f) => {
                const key = `${f.networkId}:${f.id.toLowerCase()}`;
                const s = stats[key];
                if (!s) return null;
                const bal = parseFloat(formatEther(BigInt(s.balance)));
                if (bal >= 0.1) return null;

                const net = networks.find((n) => n.id === f.networkId);
                const history = s.history.slice(-20).map((h) => parseFloat(formatEther(BigInt(h.balance))));

                return (
                  <div key={key} className="flex items-center justify-between gap-2 bg-destructive/10 p-2 sm:p-3">
                    <div className="flex flex-col overflow-hidden flex-1 min-w-0">
                      <span className="font-semibold text-sm truncate" title={f.label || f.id}>
                        {f.label || f.id.slice(0, 12) + '...'}
                      </span>
                      <span className="text-xs text-muted-foreground">{net?.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {history.length > 1 && (
                        <Sparkline data={history} width={50} height={16} color="var(--destructive)" className="hidden sm:block" />
                      )}
                      <span className="font-mono font-bold text-xs sm:text-sm text-destructive whitespace-nowrap">
                        {bal.toFixed(4)} {net?.currency}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

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
