'use client';

import { useState } from 'react';

export interface LatencyDataPoint {
  id: string;
  timestamp: string;
  dnsLookupMs: number;
  tcpConnectMs: number;
  tlsHandshakeMs: number;
  ttfbMs: number;
  contentTransferMs: number;
  totalMs: number;
}

interface LatencyBreakdownChartProps {
  data: LatencyDataPoint[];
  height?: number;
}

export function LatencyBreakdownChart({ data, height = 220 }: LatencyBreakdownChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div
        style={{ height }}
        className="w-full flex items-center justify-center rounded-xl bg-slate-900/40 border border-slate-800 text-xs text-slate-500"
      >
        Esperando muestras de latencia para graficar fases de socket...
      </div>
    );
  }

  // Chronological order for chart (oldest to newest)
  const sorted = [...data].reverse();
  const maxTotal = Math.max(...sorted.map((d) => d.totalMs), 50);

  const padding = { top: 20, right: 20, bottom: 30, left: 45 };
  const width = 800; // SVG viewBox coordinates
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const getX = (idx: number) => {
    if (sorted.length === 1) return padding.left + chartWidth / 2;
    return padding.left + (idx / (sorted.length - 1)) * chartWidth;
  };

  const getY = (val: number) => {
    return padding.top + chartHeight - (val / maxTotal) * chartHeight;
  };

  const hovered = hoverIndex !== null ? sorted[hoverIndex] : null;

  return (
    <div className="space-y-3">
      {/* Chart Legend */}
      <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-400 gap-2">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block" /> DNS
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500 inline-block" /> TCP
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-purple-500 inline-block" /> TLS
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> TTFB
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" /> Transfer
          </span>
        </div>

        {hovered && (
          <div className="text-cyan-300 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-700">
            {new Date(hovered.timestamp).toLocaleTimeString()}: {hovered.totalMs.toFixed(1)}ms
            (TTFB: {hovered.ttfbMs.toFixed(1)}ms, TLS: {hovered.tlsHandshakeMs.toFixed(1)}ms)
          </div>
        )}
      </div>

      {/* SVG Canvas */}
      <div className="relative w-full rounded-2xl bg-[#090e1a] border border-slate-800 p-2 overflow-hidden shadow-inner">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Horizontal Gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const val = maxTotal * ratio;
            const y = getY(val);
            return (
              <g key={ratio}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="#1e293b"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-slate-500 text-[10px] font-mono"
                >
                  {val.toFixed(0)}ms
                </text>
              </g>
            );
          })}

          {/* Stacked Bars / Columns */}
          {sorted.map((d, i) => {
            const x = getX(i);
            const colWidth = Math.max(4, Math.min(24, chartWidth / sorted.length - 2));

            // Cumulative stacked heights
            const hDns = (d.dnsLookupMs / maxTotal) * chartHeight;
            const hTcp = (d.tcpConnectMs / maxTotal) * chartHeight;
            const hTls = (d.tlsHandshakeMs / maxTotal) * chartHeight;
            const hTtfb = (d.ttfbMs / maxTotal) * chartHeight;
            const hTransfer = (d.contentTransferMs / maxTotal) * chartHeight;

            let curY = padding.top + chartHeight;

            const yDns = curY - hDns;
            curY = yDns;

            const yTcp = curY - hTcp;
            curY = yTcp;

            const yTls = curY - hTls;
            curY = yTls;

            const yTtfb = curY - hTtfb;
            curY = yTtfb;

            const yTransfer = curY - hTransfer;

            return (
              <g
                key={d.id}
                onMouseEnter={() => setHoverIndex(i)}
                className="cursor-pointer transition-opacity"
                opacity={hoverIndex === null || hoverIndex === i ? 1 : 0.4}
              >
                {/* DNS segment */}
                <rect
                  x={x - colWidth / 2}
                  y={yDns}
                  width={colWidth}
                  height={Math.max(1, hDns)}
                  fill="#6366f1"
                  rx="1"
                />
                {/* TCP segment */}
                <rect
                  x={x - colWidth / 2}
                  y={yTcp}
                  width={colWidth}
                  height={Math.max(1, hTcp)}
                  fill="#06b6d4"
                />
                {/* TLS segment */}
                <rect
                  x={x - colWidth / 2}
                  y={yTls}
                  width={colWidth}
                  height={Math.max(1, hTls)}
                  fill="#a855f7"
                />
                {/* TTFB segment */}
                <rect
                  x={x - colWidth / 2}
                  y={yTtfb}
                  width={colWidth}
                  height={Math.max(1, hTtfb)}
                  fill="#10b981"
                />
                {/* Transfer segment */}
                <rect
                  x={x - colWidth / 2}
                  y={yTransfer}
                  width={colWidth}
                  height={Math.max(1, hTransfer)}
                  fill="#f59e0b"
                  rx="1"
                />

                {/* Invisible hover trigger area */}
                <rect
                  x={x - colWidth}
                  y={padding.top}
                  width={colWidth * 2}
                  height={chartHeight}
                  fill="transparent"
                />
              </g>
            );
          })}

          {/* Time axis labels */}
          {sorted.length > 0 && sorted[0] && (
            <>
              <text
                x={padding.left}
                y={height - 8}
                className="fill-slate-500 text-[10px] font-mono"
              >
                {new Date(sorted[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </text>
              <text
                x={width - padding.right}
                y={height - 8}
                textAnchor="end"
                className="fill-slate-500 text-[10px] font-mono"
              >
                {new Date(sorted[sorted.length - 1]!.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </text>
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
