'use client';

import { useState } from 'react';

export interface UptimeBucket {
  bucketIndex: number;
  startTime: string;
  endTime: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'NONE';
  sampleCount: number;
  uptimePercentage: number;
  avgLatencyMs: number;
}

interface UptimeBarProps {
  buckets: UptimeBucket[];
  uptimePercentage: number;
  timeframeLabel?: string;
}

export function UptimeBar({
  buckets,
  uptimePercentage,
  timeframeLabel = 'Últimas 24h',
}: UptimeBarProps) {
  const [hoveredBucket, setHoveredBucket] = useState<UptimeBucket | null>(null);

  return (
    <div className="space-y-2">
      {/* Top Header */}
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span className="font-medium text-slate-300">{timeframeLabel}</span>
        <span className="font-mono font-semibold text-emerald-400">
          {uptimePercentage.toFixed(2)}% de disponibilidad
        </span>
      </div>

      {/* The Visual Segment Matrix */}
      <div className="relative flex items-center gap-[3px] h-8 p-1 rounded-xl bg-slate-900/80 border border-slate-800/80 shadow-inner">
        {buckets.map((b) => {
          let bgClass = 'bg-slate-700/50 hover:bg-slate-600';
          if (b.status === 'HEALTHY') {
            bgClass = 'bg-emerald-500 hover:bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.3)]';
          } else if (b.status === 'DEGRADED') {
            bgClass = 'bg-amber-500 hover:bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.4)]';
          } else if (b.status === 'DOWN') {
            bgClass = 'bg-red-500 hover:bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.5)]';
          }

          return (
            <div
              key={b.bucketIndex}
              onMouseEnter={() => setHoveredBucket(b)}
              onMouseLeave={() => setHoveredBucket(null)}
              className={`flex-1 h-full rounded-[4px] transition-all duration-150 cursor-pointer ${bgClass}`}
            />
          );
        })}
      </div>

      {/* Floating or Inline Tooltip */}
      {hoveredBucket && (
        <div className="p-2.5 rounded-lg bg-[#0c1222] border border-slate-700 text-xs shadow-xl animate-in fade-in duration-100 flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="text-[11px] text-slate-400">
              {new Date(hoveredBucket.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –{' '}
              {new Date(hoveredBucket.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="font-semibold text-slate-200">
              Estado: <span className={
                hoveredBucket.status === 'HEALTHY'
                  ? 'text-emerald-400'
                  : hoveredBucket.status === 'DEGRADED'
                  ? 'text-amber-400'
                  : hoveredBucket.status === 'DOWN'
                  ? 'text-red-400'
                  : 'text-slate-400'
              }>
                {hoveredBucket.status === 'NONE' ? 'Sin muestras' : hoveredBucket.status}
              </span>
            </div>
          </div>
          <div className="text-right text-[11px] space-y-0.5 font-mono">
            <div className="text-slate-300">
              Latencia: <span className="font-bold text-amber-300">{hoveredBucket.avgLatencyMs.toFixed(1)}ms</span>
            </div>
            <div className="text-slate-400">
              Muestras: <span className="text-white">{hoveredBucket.sampleCount}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
