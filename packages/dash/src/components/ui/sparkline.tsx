import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
  color?: string;
  showArea?: boolean;
  showDot?: boolean;
  responsive?: boolean;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  strokeWidth = 1.5,
  className,
  color = 'currentColor',
  showArea = false,
  showDot = true,
  responsive = false,
}: SparklineProps) {
  const path = useMemo(() => {
    if (data.length < 2) return '';

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const padding = 2;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const points = data.map((value, index) => {
      const x = padding + (index / (data.length - 1)) * chartWidth;
      const y = padding + chartHeight - ((value - min) / range) * chartHeight;
      return { x, y };
    });

    const linePath = points
      .map((point, i) => `${i === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' ');

    return linePath;
  }, [data, width, height]);

  const areaPath = useMemo(() => {
    if (!showArea || data.length < 2) return '';

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const padding = 2;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const points = data.map((value, index) => {
      const x = padding + (index / (data.length - 1)) * chartWidth;
      const y = padding + chartHeight - ((value - min) / range) * chartHeight;
      return { x, y };
    });

    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];

    return `${path} L ${lastPoint.x.toFixed(2)} ${height - padding} L ${firstPoint.x.toFixed(2)} ${height - padding} Z`;
  }, [path, data, width, height, showArea]);

  const lastPoint = useMemo(() => {
    if (data.length < 2) return null;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const padding = 2;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const lastValue = data[data.length - 1];
    return {
      x: padding + chartWidth,
      y: padding + chartHeight - ((lastValue - min) / range) * chartHeight,
    };
  }, [data, width, height]);

  const trend = useMemo(() => {
    if (data.length < 2) return 0;
    const first = data[0];
    const last = data[data.length - 1];
    if (first === 0) return last > 0 ? 100 : 0;
    return ((last - first) / Math.abs(first)) * 100;
  }, [data]);

  if (data.length < 2) {
    return (
      <div className={cn('flex items-center justify-center text-muted-foreground text-xs', className)} style={responsive ? { width: '100%', height } : { width, height }}>
        --
      </div>
    );
  }

  const trendColor = trend >= 0 ? 'var(--foreground)' : 'var(--destructive)';
  const effectiveColor = color === 'auto' ? trendColor : color;

  return (
    <svg
      width={responsive ? '100%' : width}
      height={height}
      className={cn('overflow-visible', className)}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={responsive ? 'none' : undefined}
    >
      {showArea && (
        <path
          d={areaPath}
          fill={effectiveColor}
          fillOpacity={0.1}
        />
      )}
      <path
        d={path}
        fill="none"
        stroke={effectiveColor}
        strokeWidth={strokeWidth}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      {showDot && lastPoint && (
        <rect
          x={lastPoint.x - 1.5}
          y={lastPoint.y - 1.5}
          width={3}
          height={3}
          fill={effectiveColor}
        />
      )}
    </svg>
  );
}

interface TrendIndicatorProps {
  value: number;
  suffix?: string;
  className?: string;
  showIcon?: boolean;
}

export function TrendIndicator({ value, suffix = '%', className, showIcon = true }: TrendIndicatorProps) {
  const isPositive = value >= 0;
  const displayValue = Math.abs(value);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        isPositive ? 'text-foreground' : 'text-destructive',
        className
      )}
    >
      {showIcon && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className={cn(!isPositive && 'rotate-180')}
        >
          <path
            d="M5 2L8 6H2L5 2Z"
            fill="currentColor"
          />
        </svg>
      )}
      {displayValue.toFixed(1)}{suffix}
    </span>
  );
}
