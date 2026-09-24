import React, { useState } from 'react';

interface SparklineProps {
  values: number[];
  labels: string[];
  width?: number;
  height?: number;
  format?: (v: number) => string;
  color?: string;
}

/** Minimal single-series trend line with a hover readout. */
export const Sparkline: React.FC<SparklineProps> = ({
  values, labels, width = 120, height = 28, format = (v) => v.toLocaleString(), color = 'var(--accent-cyan)',
}) => {
  const [hover, setHover] = useState<number | null>(null);
  const n = values.length;
  if (n < 2) return null;

  const pad = 3;
  const max = Math.max(1, ...values);
  const x = (i: number) => pad + (i / (n - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;
  const focus = hover ?? n - 1;

  return (
    <span style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Trend: ${values.map(format).join(', ')}`}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - rect.left - pad) / (width - pad * 2)) * (n - 1));
          setHover(Math.min(n - 1, Math.max(0, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <path d={area} fill={color} opacity={0.12} />
        <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke="var(--text-dim)" strokeWidth={1} />
        )}
        <circle cx={x(focus)} cy={y(values[focus])} r={2.5} fill={color} stroke="var(--bg-card)" strokeWidth={1.5} />
      </svg>
      {hover !== null && (
        <span
          className="chart-tooltip"
          style={{ left: x(hover), top: -6, transform: 'translate(-50%, -100%)', lineHeight: 1.4 }}
        >
          {labels[hover]} · <strong>{format(values[hover])}</strong>
        </span>
      )}
    </span>
  );
};
