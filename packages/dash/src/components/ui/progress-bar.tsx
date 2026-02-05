import { cn } from '@/lib/utils';

interface ProgressBarProps {
  value: number;
  max?: number;
  className?: string;
  barClassName?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  color?: string;
}

export function ProgressBar({
  value,
  max = 100,
  className,
  barClassName,
  showLabel = false,
  size = 'md',
  color,
}: ProgressBarProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  const heights = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-3',
  };

  return (
    <div className={cn('w-full', className)}>
      <div className={cn('w-full bg-muted overflow-hidden', heights[size])}>
        <div
          className={cn('h-full transition-all duration-300', barClassName)}
          style={{
            width: `${percentage}%`,
            backgroundColor: color || 'var(--primary)',
          }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-muted-foreground mt-1">{percentage.toFixed(0)}%</span>
      )}
    </div>
  );
}

interface StackedBarProps {
  segments: Array<{
    value: number;
    color: string;
    label?: string;
  }>;
  className?: string;
  height?: number;
  showLabels?: boolean;
}

export function StackedBar({ segments, className, height = 8, showLabels = false }: StackedBarProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className={cn('w-full', className)}>
      <div
        className="w-full bg-muted overflow-hidden flex"
        style={{ height }}
      >
        {segments.map((segment, i) => {
          const percentage = total > 0 ? (segment.value / total) * 100 : 0;
          if (percentage === 0) return null;
          return (
            <div
              key={i}
              className="h-full transition-all duration-300"
              style={{
                width: `${percentage}%`,
                backgroundColor: segment.color,
              }}
              title={segment.label ? `${segment.label}: ${percentage.toFixed(1)}%` : undefined}
            />
          );
        })}
      </div>
      {showLabels && (
        <div className="flex flex-wrap gap-3 mt-2">
          {segments.map((segment, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5"
                style={{ backgroundColor: segment.color }}
              />
              <span className="text-xs text-muted-foreground">{segment.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface GaugeProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  bgColor?: string;
  label?: string;
  className?: string;
}

export function Gauge({
  value,
  max = 100,
  size = 80,
  strokeWidth = 8,
  color = 'var(--primary)',
  bgColor = 'var(--muted)',
  label,
  className,
}: GaugeProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className={cn('relative inline-flex flex-col items-center', className)}>
      <svg
        width={size}
        height={size / 2 + strokeWidth}
        viewBox={`0 0 ${size} ${size / 2 + strokeWidth}`}
      >
        {/* Background arc */}
        <path
          d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
          fill="none"
          stroke={bgColor}
          strokeWidth={strokeWidth}
        />
        {/* Value arc */}
        <path
          d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute bottom-0 text-center">
        <div className="text-lg font-bold">{percentage.toFixed(0)}%</div>
        {label && <div className="text-[10px] text-muted-foreground">{label}</div>}
      </div>
    </div>
  );
}

interface ActivityHeatmapProps {
  data: Array<{ hour: number; day: number; value: number }>;
  className?: string;
  colorScale?: string[];
}

export function ActivityHeatmap({ data, className, colorScale }: ActivityHeatmapProps) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const maxValue = Math.max(...data.map(d => d.value), 1);

  const defaultColors = [
    'var(--muted)',
    'oklch(0.65 0.08 175)',
    'oklch(0.55 0.12 175)',
    'oklch(0.45 0.15 175)',
  ];
  const colors = colorScale || defaultColors;

  const getColor = (value: number) => {
    if (value === 0) return colors[0];
    const intensity = Math.min(Math.floor((value / maxValue) * (colors.length - 1)) + 1, colors.length - 1);
    return colors[intensity];
  };

  const getValue = (day: number, hour: number) => {
    const item = data.find(d => d.day === day && d.hour === hour);
    return item?.value || 0;
  };

  return (
    <div className={cn('overflow-x-auto', className)}>
      <div className="inline-flex flex-col gap-0.5 min-w-max">
        {/* Hour labels */}
        <div className="flex gap-0.5 ml-8">
          {hours.filter((_, i) => i % 3 === 0).map(h => (
            <div key={h} className="w-[30px] text-[9px] text-muted-foreground text-center">
              {h.toString().padStart(2, '0')}
            </div>
          ))}
        </div>
        {/* Grid */}
        {days.map((day, dayIndex) => (
          <div key={day} className="flex items-center gap-0.5">
            <div className="w-7 text-[9px] text-muted-foreground text-right pr-1">{day}</div>
            {hours.map(hour => {
              const value = getValue(dayIndex, hour);
              return (
                <div
                  key={hour}
                  className="w-2.5 h-2.5 transition-colors"
                  style={{ backgroundColor: getColor(value) }}
                  title={`${day} ${hour}:00 - ${value} tx`}
                />
              );
            })}
          </div>
        ))}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-2 mt-2 text-[9px] text-muted-foreground">
        <span>Less</span>
        {colors.map((color, i) => (
          <div key={i} className="w-2.5 h-2.5" style={{ backgroundColor: color }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

interface HealthScoreProps {
  score: number;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function HealthScore({ score, label, size = 'md', className }: HealthScoreProps) {
  const getColor = () => {
    if (score >= 80) return 'var(--success)';
    if (score >= 50) return 'var(--warning)';
    return 'var(--destructive)';
  };

  const getLabel = () => {
    if (score >= 80) return 'Healthy';
    if (score >= 50) return 'Warning';
    return 'Critical';
  };

  const sizes = {
    sm: { outer: 40, stroke: 4, text: 'text-xs', label: 'text-[8px]' },
    md: { outer: 56, stroke: 5, text: 'text-sm', label: 'text-[9px]' },
    lg: { outer: 72, stroke: 6, text: 'text-lg', label: 'text-[10px]' },
  };

  const s = sizes[size];
  const radius = (s.outer - s.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <svg width={s.outer} height={s.outer} className="-rotate-90">
        <circle
          cx={s.outer / 2}
          cy={s.outer / 2}
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={s.stroke}
        />
        <circle
          cx={s.outer / 2}
          cy={s.outer / 2}
          r={radius}
          fill="none"
          stroke={getColor()}
          strokeWidth={s.stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute text-center">
        <div className={cn('font-bold', s.text)}>{score}</div>
        {label !== undefined ? (
          <div className={cn('text-muted-foreground', s.label)}>{label}</div>
        ) : (
          <div className={cn('text-muted-foreground', s.label)}>{getLabel()}</div>
        )}
      </div>
    </div>
  );
}

interface ComparisonBarProps {
  current: number;
  previous: number;
  label?: string;
  format?: (v: number) => string;
  className?: string;
}

export function ComparisonBar({ current, previous, label, format, className }: ComparisonBarProps) {
  const max = Math.max(current, previous, 1);
  const currentPct = (current / max) * 100;
  const previousPct = (previous / max) * 100;
  const change = previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : 0;
  const formatFn = format || ((v: number) => v.toFixed(2));

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <div className="text-xs text-muted-foreground">{label}</div>}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="w-16 text-[10px] text-muted-foreground">Current</div>
          <div className="flex-1 h-2 bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${currentPct}%` }} />
          </div>
          <div className="w-16 text-xs font-mono text-right">{formatFn(current)}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-16 text-[10px] text-muted-foreground">Previous</div>
          <div className="flex-1 h-2 bg-muted overflow-hidden">
            <div className="h-full bg-muted-foreground/30 transition-all" style={{ width: `${previousPct}%` }} />
          </div>
          <div className="w-16 text-xs font-mono text-right text-muted-foreground">{formatFn(previous)}</div>
        </div>
      </div>
      <div className={cn('text-xs font-medium', change >= 0 ? 'text-foreground' : 'text-destructive')}>
        {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}% vs previous
      </div>
    </div>
  );
}
