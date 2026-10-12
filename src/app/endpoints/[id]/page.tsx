'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  RefreshCw,
  Clock,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Layers,
  Download,
  Settings,
  Pause,
  Play,
} from 'lucide-react';
import { LatencyBreakdownChart, LatencyDataPoint } from '@/components/latency-breakdown-chart';
import { ErrorBudgetWidget } from '@/components/error-budget-widget';
import { MultiRegionGrid } from '@/components/multi-region-grid';
import { EditEndpointModal, EndpointDataForEdit } from '@/components/edit-endpoint-modal';
import { SloReport } from '@/core/domain/services/slo-calculator.service';

interface LatencyBreakdown {
  dnsLookupMs: number;
  tcpConnectMs: number;
  tlsHandshakeMs: number;
  ttfbMs: number;
  contentTransferMs: number;
  totalMs: number;
}

interface SslInfo {
  valid: boolean;
  issuer: string;
  validTo: string;
  daysRemaining: number;
}

interface EndpointDetail {
  id: string;
  name: string;
  url: string;
  method: string;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusCodes: number[];
  isActive: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  latestCheck: RecentSample | null;
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
  sloReport: SloReport;
}

interface RecentSample {
  id: string;
  timestamp: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  statusCode: number | null;
  statusText: string | null;
  latency: LatencyBreakdown;
  sslInfo: SslInfo | null;
  failedAssertions: string[];
  errorMessage: string | null;
  region: string;
}

export default function EndpointDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [endpoint, setEndpoint] = useState<EndpointDetail | null>(null);
  const [samples, setSamples] = useState<RecentSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      // Fetch full endpoint with aggregates and SLO report
      const res = await fetch(`/api/endpoints/${id}`);
      const json = await res.json();
      if (json.success && json.data) {
        setEndpoint(json.data);
      }

      // Fetch recent detailed samples for telemetry chart & table
      const samplesRes = await fetch(`/api/endpoints/${id}/export?format=json&limit=30`);
      const samplesJson = await samplesRes.json();
      if (samplesJson.success && samplesJson.samples) {
        setSamples(samplesJson.samples);
      }
    } catch (err) {
      console.error('Error fetching endpoint details:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [id]);

  const handleManualProbe = async () => {
    try {
      setProbing(true);
      const res = await fetch(`/api/endpoints/${id}/probe`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setSamples((prev) => [json.data, ...prev.slice(0, 29)]);
        // Refresh aggregate metrics
        void fetchData();
      }
    } catch (err) {
      console.error('Error probing endpoint:', err);
    } finally {
      setProbing(false);
    }
  };

  const handleToggleActive = async () => {
    if (!endpoint) return;
    try {
      const res = await fetch(`/api/endpoints/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !endpoint.isActive }),
      });
      const json = await res.json();
      if (json.success) {
        setEndpoint((prev) => (prev ? { ...prev, isActive: !prev.isActive } : null));
      }
    } catch (err) {
      console.error('Error toggling endpoint active status:', err);
    }
  };

  const latest = samples[0] ?? endpoint?.latestCheck;
  const latency = latest?.latency;
  const isHealthy = latest?.status === 'HEALTHY';
  const isDegraded = latest?.status === 'DEGRADED';
  const isDown = latest?.status === 'DOWN';

  // Prepare chart series data
  const chartDataPoints: LatencyDataPoint[] = samples.map((s) => ({
    id: s.id,
    timestamp: s.timestamp,
    dnsLookupMs: s.latency.dnsLookupMs,
    tcpConnectMs: s.latency.tcpConnectMs,
    tlsHandshakeMs: s.latency.tlsHandshakeMs,
    ttfbMs: s.latency.ttfbMs,
    contentTransferMs: s.latency.contentTransferMs,
    totalMs: s.latency.totalMs,
  }));

  const endpointForEdit: EndpointDataForEdit | null = endpoint
    ? {
        id: endpoint.id,
        name: endpoint.name,
        url: endpoint.url,
        method: endpoint.method,
        intervalSeconds: endpoint.intervalSeconds,
        timeoutMs: endpoint.timeoutMs,
        isActive: endpoint.isActive,
        tags: endpoint.tags,
      }
    : null;

  if (loading && !endpoint) {
    return (
      <div className="min-h-screen bg-[#070a12] text-slate-100 flex items-center justify-center text-xs">
        <RefreshCw className="w-4 h-4 animate-spin text-cyan-400 mr-2" />
        <span>Cargando telemetría del endpoint y métricas SRE...</span>
      </div>
    );
  }

  if (!endpoint) {
    return (
      <div className="min-h-screen bg-[#070a12] text-slate-100 flex flex-col items-center justify-center p-4">
        <h2 className="text-base font-bold text-slate-200">Endpoint no encontrado</h2>
        <Link href="/" className="mt-4 px-4 py-2 rounded-lg bg-cyan-600 text-xs font-semibold text-white">
          Volver a la consola
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070a12] text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-white">
      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-[#0c1222]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 rounded-lg border border-slate-700 bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 transition"
              title="Volver al Dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 font-mono text-[10px] font-bold">
                  {endpoint.method}
                </span>
                <h1 className="font-bold text-lg text-white truncate max-w-md">{endpoint.name}</h1>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    endpoint.isActive
                      ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/30'
                      : 'bg-amber-950/80 text-amber-400 border border-amber-500/30'
                  }`}
                >
                  {endpoint.isActive ? 'ACTIVO' : 'PAUSADO'}
                </span>
              </div>
              <p className="text-xs font-mono text-slate-400 truncate max-w-lg">{endpoint.url}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Quick Pause / Resume Button */}
            <button
              onClick={handleToggleActive}
              className={`px-3 py-2 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition ${
                endpoint.isActive
                  ? 'border-amber-500/40 bg-amber-950/20 text-amber-300 hover:bg-amber-900/30'
                  : 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-900/30'
              }`}
              title={endpoint.isActive ? 'Pausar sondeo automático' : 'Reanudar sondeo automático'}
            >
              {endpoint.isActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{endpoint.isActive ? 'Pausar' : 'Reanudar'}</span>
            </button>

            {/* Export CSV Button */}
            <a
              href={`/api/endpoints/${id}/export?format=csv`}
              download
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 flex items-center gap-1.5 transition"
              title="Descargar historial de telemetría en CSV para auditoría"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </a>

            {/* Edit / Settings Button */}
            <button
              onClick={() => setShowEditModal(true)}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
              title="Configuración del endpoint"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* Probe Now Button */}
            <button
              onClick={handleManualProbe}
              disabled={probing}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-2 transition disabled:opacity-50 shadow-md"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${probing ? 'animate-spin' : ''}`} />
              <span>{probing ? 'Sondando Socket...' : 'Sondar Ahora'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8 flex-1 w-full space-y-8">
        {/* Status & Key Metrics Banner */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-[#0f172a] border border-slate-800">
            <span className="text-xs font-semibold uppercase text-slate-400 block">Estado Actual</span>
            <div className="mt-2 flex items-center gap-2">
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
                  isHealthy
                    ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-400'
                    : isDegraded
                    ? 'border-amber-500/30 bg-amber-950/20 text-amber-400'
                    : isDown
                    ? 'border-red-500/30 bg-red-950/20 text-red-400'
                    : 'border-slate-800 bg-slate-900 text-slate-400'
                }`}
              >
                {isHealthy && <CheckCircle2 className="w-3.5 h-3.5" />}
                {isDegraded && <AlertTriangle className="w-3.5 h-3.5" />}
                {isDown && <XCircle className="w-3.5 h-3.5" />}
                <span>{latest?.status ?? 'UNKNOWN'}</span>
              </span>
              <span className="text-xs font-mono text-slate-400">
                HTTP {latest?.statusCode ?? 'N/A'}
              </span>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-[#0f172a] border border-slate-800">
            <span className="text-xs font-semibold uppercase text-slate-400 block">Latencia Total Reciente</span>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold text-amber-300">
                {latency ? latency.totalMs.toFixed(1) : '—'}
              </span>
              <span className="text-xs text-slate-400">ms</span>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-[#0f172a] border border-slate-800">
            <span className="text-xs font-semibold uppercase text-slate-400 block">Frecuencia de Sondeo</span>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold text-white">{endpoint.intervalSeconds}</span>
              <span className="text-xs text-slate-400">s (Jitter activo)</span>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-[#0f172a] border border-slate-800">
            <span className="text-xs font-semibold uppercase text-slate-400 block">Uptime Registrado 24h</span>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold text-emerald-400">
                {endpoint.aggregates.uptimePercentage}%
              </span>
              <span className="text-xs text-slate-400">
                ({endpoint.aggregates.totalChecks} muestras)
              </span>
            </div>
          </div>
        </section>

        {/* SRE Service Level Objective & Error Budget */}
        {endpoint.sloReport && (
          <section>
            <ErrorBudgetWidget report={endpoint.sloReport} />
          </section>
        )}

        {/* Interactive Socket Phase Latency Breakdown Stacked Chart */}
        <section className="rounded-2xl border border-slate-800 bg-[#0d1424] p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-cyan-400" />
              <div>
                <h3 className="text-base font-bold text-white">
                  Histórico de Latencia por Fase de Socket (RED Telemetry Series)
                </h3>
                <p className="text-xs text-slate-400">
                  Inspección milisegundo a milisegundo de DNS, TCP 3-Way, TLS SNI, TTFB y Transferencia
                </p>
              </div>
            </div>
            <span className="text-xs font-mono text-slate-400">
              {samples.length} muestras analizadas
            </span>
          </div>

          <LatencyBreakdownChart data={chartDataPoints} height={230} />
        </section>

        {/* Global Multi-Region Synthetic Probing */}
        <section>
          <MultiRegionGrid endpointId={endpoint.id} />
        </section>

        {/* SSL Certificate & Security Inspector */}
        {latest?.sslInfo && (
          <section className="rounded-2xl border border-slate-800 bg-[#0d1424] p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">Inspección de Certificado SSL / TLS</h3>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold border border-emerald-500/30 bg-emerald-950/20 text-emerald-400">
                {latest.sslInfo.valid ? 'Certificado Válido' : 'Certificado Inválido'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
                <span className="text-slate-400 text-[11px]">Autoridad Certificadora (Emisor)</span>
                <p className="font-bold text-white text-sm truncate">{latest.sslInfo.issuer}</p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
                <span className="text-slate-400 text-[11px]">Fecha de Caducidad</span>
                <p className="font-bold text-white text-sm">
                  {new Date(latest.sslInfo.validTo).toLocaleDateString()}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
                <span className="text-slate-400 text-[11px]">Días Restantes</span>
                <p className="font-extrabold text-emerald-400 text-lg">
                  {latest.sslInfo.daysRemaining} días
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Recent Check Samples Table */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <span>Muestras Recientes de Telemetría ({samples.length})</span>
            </h3>
            <a
              href={`/api/endpoints/${id}/export?format=csv`}
              download
              className="text-xs font-mono text-cyan-400 hover:underline flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descargar CSV Completo</span>
            </a>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0d1424] overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800 text-[11px] font-mono uppercase">
                  <tr>
                    <th className="p-3.5">Timestamp</th>
                    <th className="p-3.5">Estado</th>
                    <th className="p-3.5">HTTP Code</th>
                    <th className="p-3.5">DNS</th>
                    <th className="p-3.5">TCP</th>
                    <th className="p-3.5">TLS</th>
                    <th className="p-3.5">TTFB</th>
                    <th className="p-3.5">Transfer</th>
                    <th className="p-3.5 text-right">Latencia Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {samples.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-800/40 transition">
                      <td className="p-3.5 text-slate-300">
                        {new Date(s.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            s.status === 'HEALTHY'
                              ? 'bg-emerald-950 text-emerald-400'
                              : s.status === 'DEGRADED'
                              ? 'bg-amber-950 text-amber-400'
                              : 'bg-red-950 text-red-400'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="p-3.5 text-slate-300">{s.statusCode ?? 'N/A'}</td>
                      <td className="p-3.5 text-slate-400">{s.latency.dnsLookupMs.toFixed(1)}ms</td>
                      <td className="p-3.5 text-slate-400">{s.latency.tcpConnectMs.toFixed(1)}ms</td>
                      <td className="p-3.5 text-slate-400">{s.latency.tlsHandshakeMs.toFixed(1)}ms</td>
                      <td className="p-3.5 text-slate-400">{s.latency.ttfbMs.toFixed(1)}ms</td>
                      <td className="p-3.5 text-slate-400">{s.latency.contentTransferMs.toFixed(1)}ms</td>
                      <td className="p-3.5 text-right font-bold text-amber-300">
                        {s.latency.totalMs.toFixed(1)}ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      {/* Edit & Delete Modal */}
      <EditEndpointModal
        endpoint={endpointForEdit}
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSaved={fetchData}
        onDeleted={() => router.push('/')}
      />
    </div>
  );
}
