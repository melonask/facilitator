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
