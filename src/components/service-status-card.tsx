'use client';

import React from 'react';
import Link from 'next/link';
import {
  Clock,
  Play,
  Pause,
  RefreshCw,
  Settings,
  Download,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { LatencySparkline } from '@/components/latency-sparkline';
import { UptimeBar, UptimeBucket } from '@/components/uptime-bar';
import { formatLatencyMs, formatUptimePercent } from '@/presentation/view-models/status-presentation';

export interface ServiceLatencyBreakdown {
  dnsLookupMs: number;
  tcpConnectMs: number;
  tlsHandshakeMs: number;
  ttfbMs: number;
  contentTransferMs: number;
  totalMs: number;
}

export interface ServiceSslInfo {
  valid: boolean;
  issuer: string;
  validTo: string;
  daysRemaining: number;
}

export interface ServiceLatestCheck {
  id: string;
  timestamp: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN' | 'OPERATIONAL';
  statusCode: number | null;
  latency: ServiceLatencyBreakdown;
  sslInfo: ServiceSslInfo | null;
  failedAssertions: string[];
  errorMessage: string | null;
}

export interface ServiceCardData {
  id: string;
  name: string;
  url: string;
  method: string;
  intervalSeconds: number;
  timeoutMs: number;
  isActive: boolean;
  tags: string[];
  latestCheck: ServiceLatestCheck | null;
  historyBuckets?: UptimeBucket[];
  aggregates: {
    totalChecks: number;
    healthyChecks: number;
    degradedChecks: number;
    downChecks: number;
    uptimePercentage: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
  };
}

export interface ServiceStatusCardProps {
  service: ServiceCardData;
  isProbing?: boolean;
  onProbe?: (id: string) => void;
  onToggleActive?: (service: ServiceCardData) => void;
  onEdit?: (service: ServiceCardData) => void;
  className?: string;
}

/**
 * Tarjeta reactiva de estado en vivo para servicios y endpoints supervisados.
 * Integra badges de estado animados (verde/OPERATIONAL, ámbar/DEGRADED, rojo/DOWN),
 * gráfica sparkline SVG de latencia con tooltips en milisegundos, barra de uptime
 * e inspección detallada de socket/RED.
 */
export function ServiceStatusCard({
  service,
  isProbing = false,
  onProbe,
  onToggleActive,
  onEdit,
  className = '',
}: ServiceStatusCardProps) {
  const latest = service.latestCheck;
  const status = latest?.status ?? 'UNKNOWN';

  // Preparar datos para la sparkline de latencia a partir de los buckets de historial o latencia actual
  const sparklineData = React.useMemo(() => {
    if (service.historyBuckets && service.historyBuckets.length > 0) {
      return service.historyBuckets.map((b) => ({
        value: b.avgLatencyMs,
        timestamp: b.startTime,
        label: `${new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${b.status})`,
      }));
    }
    if (latest?.latency) {
      // Fallback a punto único
      return [{ value: latest.latency.totalMs, timestamp: latest.timestamp }];
    }
    return [];
  }, [service.historyBuckets, latest]);

  const latency = latest?.latency;
  const totalLatency = latency ? latency.totalMs : 0;

  // Color de borde de tarjeta reactivo
  let cardBorderClass = 'border-slate-800 hover:border-slate-700';
  if (status === 'DOWN') cardBorderClass = 'border-red-900/60 shadow-red-950/20';
  else if (status === 'DEGRADED') cardBorderClass = 'border-amber-900/60 shadow-amber-950/20';

  return (
    <article
      aria-label={`Servicio: ${service.name}`}
      className={`rounded-2xl border bg-[#0d1424] p-5 shadow-lg transition-all duration-200 space-y-4 relative overflow-hidden ${cardBorderClass} ${className}`}
    >
      {/* Encabezado: Título, Badge Animado, Estado Activo y Acciones Principales */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Información del Endpoint */}
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Badge Animado de Estatus */}
            <StatusBadge status={status} size="md" animated={service.isActive} />

            {/* Nombre del Servicio con enlace a detalle */}
            <Link
              href={`/endpoints/${service.id}`}
              className="text-base font-bold text-white hover:text-cyan-400 transition underline-offset-4 hover:underline truncate max-w-md"
            >
              {service.name}
            </Link>

            {/* Botón de Pausa / Reanudación de Sondeo */}
            {onToggleActive && (
              <button
                type="button"
                onClick={() => onToggleActive(service)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 transition focus:outline-none focus:ring-1 focus:ring-cyan-500 ${
                  service.isActive
                    ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-400 hover:bg-emerald-900/40'
                    : 'border-amber-500/30 bg-amber-950/20 text-amber-400 hover:bg-amber-900/40'
                }`}
                title={service.isActive ? 'Pausar sondeo automático' : 'Reanudar sondeo automático'}
                aria-label={service.isActive ? 'Pausar sondeo del endpoint' : 'Reanudar sondeo del endpoint'}
              >
                {service.isActive ? <Play className="w-2.5 h-2.5" /> : <Pause className="w-2.5 h-2.5" />}
                <span>{service.isActive ? 'ACTIVO' : 'PAUSADO'}</span>
              </button>
            )}
          </div>

          {/* URL, Método HTTP y Frecuencia */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400">
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-bold text-[10px]">
              {service.method}
            </span>
            <span className="text-slate-300 truncate max-w-md" title={service.url}>
              {service.url}
            </span>
            <span className="text-slate-600">•</span>
            <span>Cada {service.intervalSeconds}s</span>

            {service.tags && service.tags.length > 0 && (
              <>
                <span className="text-slate-600">•</span>
                <span className="text-[10px] text-slate-400">
                  {service.tags.map((t) => `#${t}`).join(' ')}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Métricas Numéricas y Acciones */}
        <div className="flex flex-wrap items-center gap-4 lg:gap-6">
          {/* Uptime 24h */}
          <div className="text-right">
            <div className="text-[11px] text-slate-400">Uptime (24h)</div>
            <div className="text-base font-bold font-mono text-emerald-400">
              {formatUptimePercent(service.aggregates.uptimePercentage)}
            </div>
          </div>

          {/* Latencia Actual */}
          <div className="text-right">
            <div className="text-[11px] text-slate-400">Latencia Actual</div>
            <div className="text-base font-bold font-mono text-amber-300">
              {formatLatencyMs(totalLatency)}
            </div>
          </div>

          {/* p95 / p99 */}
          <div className="text-right hidden sm:block">
            <div className="text-[11px] text-slate-400">p95 / p99</div>
            <div className="text-xs font-mono text-slate-300">
              {service.aggregates.p95LatencyMs}ms / {service.aggregates.p99LatencyMs}ms
            </div>
          </div>

          {/* Botones de Acción */}
          <div className="flex items-center gap-2">
            {/* Exportar CSV */}
            <a
              href={`/api/endpoints/${service.id}/export?format=csv`}
              download
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 transition focus:outline-none focus:ring-2 focus:ring-cyan-500"
              title="Descargar telemetría CSV"
              aria-label="Descargar telemetría en formato CSV"
            >
              <Download className="w-3.5 h-3.5" />
            </a>

            {/* Configurar */}
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(service)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 transition focus:outline-none focus:ring-2 focus:ring-cyan-500"
                title="Configuración del endpoint"
                aria-label="Editar configuración del endpoint"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Sondar Ahora */}
            {onProbe && (
              <button
                type="button"
                onClick={() => onProbe(service.id)}
                disabled={isProbing}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 flex items-center gap-2 transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                aria-label="Ejecutar sonda manual inmediata"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin text-cyan-400' : ''}`} />
                <span>{isProbing ? 'Sondando...' : 'Sondar Ahora'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Gráfica Sparkline de Latencia Histórica con Tooltips en ms */}
      {sparklineData.length > 0 && (
        <div className="pt-2 pb-1 border-t border-slate-800/60">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5 font-mono">
            <span className="flex items-center gap-1.5 text-slate-300 font-semibold">
              <Clock className="w-3 h-3 text-cyan-400" />
              <span>Tendencia de Latencia Histórica</span>
            </span>
            <Link
              href={`/endpoints/${service.id}`}
              className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1"
            >
              <span>Ver análisis completo</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </Link>
          </div>
          <LatencySparkline
            data={sparklineData}
            width={700}
            height={50}
            showStats={true}
            showTooltips={true}
            title={`Latencia histórica de ${service.name}`}
          />
        </div>
      )}

      {/* Barra de Uptime 24h (BetterStack-Style) */}
      {service.historyBuckets && service.historyBuckets.length > 0 && (
        <div className="pt-1">
          <UptimeBar
            buckets={service.historyBuckets}
            uptimePercentage={service.aggregates.uptimePercentage}
            timeframeLabel="Disponibilidad 24h (Segmentos horarios)"
          />
        </div>
      )}

      {/* Desglose de Fases de Socket (RED Telemetry) */}
      {latency && totalLatency > 0 && (
        <div className="pt-3 border-t border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="font-semibold text-slate-300 flex items-center gap-1">
              <Clock className="w-3 h-3 text-cyan-400" /> Desglose de Socket & RED Telemetry
            </span>
            <span className="font-mono text-slate-400">
              Total: {totalLatency.toFixed(2)}ms (HTTP {latest?.statusCode ?? 'N/A'})
            </span>
          </div>

          {/* Barra apilada proporcional de fases de red */}
          <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden flex shadow-inner">
            <div
              style={{ width: `${Math.max(2, (latency.dnsLookupMs / totalLatency) * 100)}%` }}
              title={`DNS: ${latency.dnsLookupMs}ms`}
              className="bg-indigo-500 h-full transition-all"
            />
            <div
              style={{ width: `${Math.max(2, (latency.tcpConnectMs / totalLatency) * 100)}%` }}
              title={`TCP Connect: ${latency.tcpConnectMs}ms`}
              className="bg-cyan-500 h-full transition-all"
            />
            <div
              style={{ width: `${Math.max(2, (latency.tlsHandshakeMs / totalLatency) * 100)}%` }}
              title={`TLS Handshake: ${latency.tlsHandshakeMs}ms`}
              className="bg-purple-500 h-full transition-all"
            />
            <div
              style={{ width: `${Math.max(2, (latency.ttfbMs / totalLatency) * 100)}%` }}
              title={`TTFB: ${latency.ttfbMs}ms`}
              className="bg-emerald-500 h-full transition-all"
            />
            <div
              style={{ width: `${Math.max(2, (latency.contentTransferMs / totalLatency) * 100)}%` }}
              title={`Transfer: ${latency.contentTransferMs}ms`}
              className="bg-amber-500 h-full transition-all"
            />
          </div>

          {/* Leyenda con valores numéricos */}
          <div className="flex flex-wrap items-center gap-4 text-[10px] text-slate-400 pt-0.5 font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-indigo-500" />
              <span>DNS: {latency.dnsLookupMs}ms</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-500" />
              <span>TCP: {latency.tcpConnectMs}ms</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-500" />
              <span>TLS: {latency.tlsHandshakeMs}ms</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>TTFB: {latency.ttfbMs}ms</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Transfer: {latency.contentTransferMs}ms</span>
            </div>

            {latest?.sslInfo && (
              <div className="ml-auto text-slate-400 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>SSL: {latest.sslInfo.daysRemaining}d ({latest.sslInfo.issuer})</span>
              </div>
            )}
          </div>

          {/* Banner de aserciones fallidas si existen */}
          {latest?.failedAssertions && latest.failedAssertions.length > 0 && (
            <div
              role="alert"
              className="mt-2 p-2 rounded-lg bg-amber-950/40 border border-amber-800/50 text-[11px] text-amber-300 space-y-1"
            >
              {latest.failedAssertions.map((err, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  <span>{err}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
