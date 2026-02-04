import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from './card';
import { Sparkline, TrendIndicator } from './sparkline';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  iconClassName?: string;
  trend?: number;
  trendLabel?: string;
  sparklineData?: number[];
  className?: string;
  valueClassName?: string;
  compact?: boolean;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  iconClassName,
  trend,
  trendLabel,
  sparklineData,
  className,
  valueClassName,
  compact = false,
}: StatCardProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className={cn('p-4', compact && 'p-3')}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0 space-y-1">
            <p className={cn('text-sm font-medium text-muted-foreground truncate', compact && 'text-xs')}>
              {title}
            </p>
            <div className="flex items-baseline gap-2">
              <span className={cn('text-2xl font-bold tracking-tight', compact && 'text-xl', valueClassName)}>
                {value}
              </span>
              {trend !== undefined && (
                <TrendIndicator value={trend} />
              )}
            </div>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
            {trendLabel && (
              <p className="text-xs text-muted-foreground">{trendLabel}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            {icon && (
              <div className={cn(iconClassName || 'p-2 bg-primary/10 text-primary')}>
                {icon}
              </div>
            )}
            {sparklineData && sparklineData.length > 1 && (
              <Sparkline
                data={sparklineData}
                width={64}
                height={20}
                color="auto"
                showArea
                showDot
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface MiniStatProps {
  label: string;
  value: string | number;
  subValue?: string;
  className?: string;
}

export function MiniStat({ label, value, subValue, className }: MiniStatProps) {
  return (
    <div className={cn('flex flex-col', className)}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      {subValue && <span className="text-[10px] text-muted-foreground">{subValue}</span>}
    </div>
  );
}

interface NetworkStatRowProps {
  name: string;
  color?: string;
  stats: Array<{ label: string; value: string | number }>;
  className?: string;
}

export function NetworkStatRow({ name, color, stats, className }: NetworkStatRowProps) {
  return (
    <div className={cn('py-3 px-3 bg-muted/20 hover:bg-muted/40 transition-colors border-l-2', className)} style={{ borderLeftColor: color || 'var(--border)' }}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-sm truncate">{name}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
        {stats.map((stat, i) => (
          <div key={i} className="min-w-0">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{stat.label}</div>
            <div className="text-sm font-mono font-semibold truncate">{stat.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
