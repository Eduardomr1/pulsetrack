'use client';

import React, { useId, useState, useRef } from 'react';
import {
  calculateSparkline,
  formatSparklineTooltip,
  SparklineDataInput,
  SparklinePoint,
} from '@/presentation/view-models/sparkline-math';
import { Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface LatencySparklineProps {
  data: SparklineDataInput[];
  width?: number;
  height?: number;
  strokeColor?: string;
  gradientFromColor?: string;
  gradientToColor?: string;
  slaThresholdMs?: number;
  showStats?: boolean;
  showTooltips?: boolean;
  title?: string;
  className?: string;
}

/**
 * Gráfica sparkline SVG ligera de latencia histórica con tooltips en milisegundos.
 * Diseñada para observabilidad de alta resolución sin librerías externas pesadas.
 */
export function LatencySparkline({
  data,
  width = 280,
  height = 54,
  strokeColor = '#06b6d4', // cyan-500
  gradientFromColor = 'rgba(6, 182, 212, 0.35)',
  gradientToColor = 'rgba(6, 182, 212, 0.0)',
  slaThresholdMs,
  showStats = false,
  showTooltips = true,
  title = 'Latencia histórica',
  className = '',
}: LatencySparklineProps) {
  const gradientId = useId();
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [activePoint, setActivePoint] = useState<SparklinePoint | null>(null);

  const result = calculateSparkline(data, {
    width,
    height,
    paddingTop: 8,
    paddingRight: 8,
    paddingBottom: 8,
    paddingLeft: 8,
    smooth: true,
  });

  const { points, linePath, areaPath, metrics, viewBox } = result;

  // Manejo de puntero para encontrar el punto más cercano en el eje X
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!showTooltips || points.length === 0 || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const relativeX = (clientX / rect.width) * width;

    // Buscar punto con X más cercano
    const firstPoint = points[0];
    if (!firstPoint) return;

    let closest = firstPoint;
    let minDistance = Math.abs(firstPoint.x - relativeX);

    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      if (p) {
        const dist = Math.abs(p.x - relativeX);
        if (dist < minDistance) {
          minDistance = dist;
          closest = p;
        }
      }
    }

    setActivePoint(closest);
  };

  const handlePointerLeave = () => {
    setActivePoint(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (points.length === 0) return;
    const currentIndex = activePoint ? activePoint.index : -1;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIdx = Math.min(points.length - 1, currentIndex + 1);
      const nextPoint = points[nextIdx];
      if (nextPoint) setActivePoint(nextPoint);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIdx = Math.max(0, currentIndex === -1 ? 0 : currentIndex - 1);
      const prevPoint = points[prevIdx];
      if (prevPoint) setActivePoint(prevPoint);
    } else if (e.key === 'Escape') {
      setActivePoint(null);
    }
  };

  // Estado vacío
  if (points.length === 0) {
    return (
      <div
        style={{ height }}
        className={`w-full flex items-center justify-center rounded-xl bg-slate-900/40 border border-slate-800/80 text-[11px] font-mono text-slate-500 ${className}`}
      >
        <span>Sin muestras de latencia</span>
      </div>
    );
  }

  const tooltipData = activePoint ? formatSparklineTooltip(activePoint, metrics.avg) : null;

  // Cálculo de línea de SLA en coordenadas SVG
  let slaY: number | null = null;
  if (slaThresholdMs && slaThresholdMs > 0 && metrics.max > 0) {
    const minVal = metrics.min;
    const maxVal = Math.max(metrics.max, minVal + 5);
    const range = maxVal - minVal;
    if (slaThresholdMs >= minVal && slaThresholdMs <= maxVal) {
      const norm = (slaThresholdMs - minVal) / range;
      slaY = Math.round((8 + (height - 16) - norm * (height - 16)) * 10) / 10;
    }
  }

  const ariaDescription = `${title}: Promedio ${metrics.avg} ms, Mínimo ${metrics.min} ms, Máximo ${metrics.max} ms. Última muestra: ${metrics.latest} ms. Tendencia: ${metrics.trend}.`;

  return (
    <div className={`relative flex flex-col gap-1 select-none ${className}`}>
      {/* SVG Sparkline Container */}
      <div className="relative group">
        <svg
          ref={svgRef}
          viewBox={viewBox}
          role="img"
          aria-label={ariaDescription}
          tabIndex={0}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onKeyDown={handleKeyDown}
          className="w-full h-auto overflow-visible cursor-crosshair rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
          style={{ maxHeight: height }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={gradientFromColor} />
              <stop offset="100%" stopColor={gradientToColor} />
            </linearGradient>
          </defs>

          {/* Area fill */}
          {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}

          {/* SLA Guide Line */}
          {slaY !== null && (
            <line
              x1={8}
              y1={slaY}
              x2={width - 8}
              y2={slaY}
              stroke="#f59e0b"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.6}
            />
          )}

          {/* Stroke Line */}
          <path
            d={linePath}
            fill="none"
            stroke={strokeColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-all duration-300"
          />

          {/* Crosshair & Active Point Hover Indicator */}
          {activePoint && (
            <g className="transition-all duration-100">
              {/* Vertical Guide Line */}
              <line
                x1={activePoint.x}
                y1={8}
                x2={activePoint.x}
                y2={height - 8}
                stroke="#64748b"
                strokeWidth={1}
                strokeDasharray="2 2"
                opacity={0.7}
              />
              {/* Point Outer Glow */}
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r={6}
                fill={strokeColor}
                opacity={0.3}
                className="animate-pulse"
              />
              {/* Point Core */}
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r={3.5}
                fill="#ffffff"
                stroke={strokeColor}
                strokeWidth={2}
              />
            </g>
          )}
        </svg>

        {/* Floating Tooltip displaying milliseconds */}
        {activePoint && tooltipData && showTooltips && (
          <div
            className="absolute -top-10 z-30 pointer-events-none transform -translate-x-1/2 flex flex-col items-center animate-in fade-in zoom-in-95 duration-100"
            style={{
              left: `${Math.min(92, Math.max(8, (activePoint.x / width) * 100))}%`,
            }}
          >
            <div className="px-2.5 py-1 rounded-md bg-[#0a101f] border border-cyan-500/40 shadow-xl shadow-cyan-950/50 text-[11px] font-mono whitespace-nowrap flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-cyan-400" />
              <span className="font-extrabold text-cyan-300">{tooltipData.primary}</span>
              {tooltipData.deltaText && (
                <span className="text-[10px] text-slate-400">({tooltipData.deltaText})</span>
              )}
            </div>
            {/* Tooltip downward caret */}
            <div className="w-1.5 h-1.5 rotate-45 bg-[#0a101f] border-r border-b border-cyan-500/40 -mt-1" />
          </div>
        )}
      </div>

      {/* Mini Stats Footer (Optional) */}
      {showStats && (
        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 px-1 pt-0.5 border-t border-slate-800/60">
          <div className="flex items-center gap-2">
            <span>
              Mín: <strong className="text-emerald-400">{metrics.min.toFixed(0)}ms</strong>
            </span>
            <span>•</span>
            <span>
              Prom: <strong className="text-cyan-400">{metrics.avg.toFixed(0)}ms</strong>
            </span>
            <span>•</span>
            <span>
              Máx: <strong className="text-amber-400">{metrics.max.toFixed(0)}ms</strong>
            </span>
          </div>

          <div className="flex items-center gap-1" title={`Tendencia: ${metrics.trend}`}>
            {metrics.trend === 'UP' && (
              <span className="flex items-center gap-0.5 text-rose-400">
                <TrendingUp className="w-3 h-3" /> +{metrics.deltaPercent}%
              </span>
            )}
            {metrics.trend === 'DOWN' && (
              <span className="flex items-center gap-0.5 text-emerald-400">
                <TrendingDown className="w-3 h-3" /> {metrics.deltaPercent}%
              </span>
            )}
            {metrics.trend === 'STABLE' && (
              <span className="flex items-center gap-0.5 text-slate-400">
                <Minus className="w-3 h-3" /> Estable
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
