'use client';

import React, { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  ShieldCheck,
  RefreshCw,
  Plus,
  Server,
  Zap,
  Bell,
  Radio,
  Settings,
  Pause,
  Play,
  Download,
} from 'lucide-react';
import { usePulseStream } from '@/hooks/use-pulse-stream';
import { UptimeBar, UptimeBucket } from '@/components/uptime-bar';
import { IncidentsCard, ActiveIncidentItem, ResolvedIncidentItem } from '@/components/incidents-card';
import { AlertChannelsModal } from '@/components/alert-channels-modal';
import { EditEndpointModal, EndpointDataForEdit } from '@/components/edit-endpoint-modal';

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

interface LatestCheck {
  id: string;
  timestamp: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  statusCode: number | null;
  latency: LatencyBreakdown;
  sslInfo: SslInfo | null;
  failedAssertions: string[];
  errorMessage: string | null;
}

interface EndpointSummary {
  id: string;
  name: string;
  url: string;
  method: string;
  intervalSeconds: number;
  timeoutMs: number;
  isActive: boolean;
  tags: string[];
  latestCheck: LatestCheck | null;
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

export default function DashboardPage() {
  const [endpoints, setEndpoints] = useState<EndpointSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showAlertModal, setShowAlertModal] = useState<boolean>(false);
  const [editingEndpoint, setEditingEndpoint] = useState<EndpointDataForEdit | null>(null);

  // Incidents & MTTR state
  const [activeIncidents, setActiveIncidents] = useState<ActiveIncidentItem[]>([]);
  const [recentResolved, setRecentResolved] = useState<ResolvedIncidentItem[]>([]);
  const [mttrMinutes, setMttrMinutes] = useState<number>(0);

  const handleToggleActive = async (ep: EndpointSummary) => {
    try {
      const nextActive = !ep.isActive;
      setEndpoints((prev) =>
        prev.map((item) => (item.id === ep.id ? { ...item, isActive: nextActive } : item))
      );
      await fetch(`/api/endpoints/${ep.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: nextActive }),
      });
    } catch (err) {
      console.error('Error toggling endpoint active status:', err);
      void fetchEndpoints();
    }
  };

  const [, startTransition] = useTransition();

  // SSE Live Pulse Stream
  const { isConnected, latestPulse } = usePulseStream({ enabled: true });

  // Form State
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newMethod, setNewMethod] = useState('GET');
  const [newInterval, setNewInterval] = useState(30);
  const [newSlaMs, setNewSlaMs] = useState(500);

  const fetchEndpoints = async () => {
    try {
      const res = await fetch('/api/endpoints');
      const json = await res.json();
      if (json.success) {
        // Fetch 24h history for each endpoint for the BetterStack-style bar
        const enriched = await Promise.all(
          json.data.map(async (ep: EndpointSummary) => {
            try {
              const hRes = await fetch(`/api/endpoints/${ep.id}/history?timeframe=24h`);
              const hJson = await hRes.json();
              return {
                ...ep,
                historyBuckets: hJson.success ? hJson.data.buckets : [],
              };
            } catch {
              return ep;
            }
          })
        );
        setEndpoints(enriched);
      }
    } catch (err) {
      console.error('Error fetching endpoints:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchIncidents = async () => {
    try {
      const res = await fetch('/api/incidents');
      const json = await res.json();
      if (json.success) {
        setActiveIncidents(json.data.activeIncidents);
        setRecentResolved(json.data.recentResolved);
        setMttrMinutes(json.data.summary.mttrMinutes);
      }
    } catch (err) {
      console.error('Error fetching incidents:', err);
    }
  };

  useEffect(() => {
    void fetchEndpoints();
    void fetchIncidents();
  }, []);

  // Update endpoint in-place when a live SSE pulse arrives
  useEffect(() => {
    if (latestPulse) {
      setEndpoints((prev) =>
        prev.map((ep) => {
          if (ep.id === latestPulse.endpointId) {
            return {
              ...ep,
              latestCheck: {
                id: latestPulse.id,
                timestamp: latestPulse.timestamp.toISOString(),
                status: latestPulse.status.value as 'HEALTHY' | 'DEGRADED' | 'DOWN',
                statusCode: latestPulse.statusCode,
                latency: latestPulse.latency.toJSON(),
                sslInfo: latestPulse.sslInfo,
                failedAssertions: [...latestPulse.failedAssertions],
                errorMessage: latestPulse.errorMessage,
              },
            };
          }
          return ep;
        })
      );
      void fetchIncidents();
    }
  }, [latestPulse]);

  const handleProbe = async (id: string) => {
    setProbingId(id);
    try {
      await fetch(`/api/endpoints/${id}/probe`, { method: 'POST' });
      await fetchEndpoints();
      await fetchIncidents();
    } catch (err) {
      console.error('Error probing endpoint:', err);
    } finally {
      setProbingId(null);
    }
  };

  const handleCreateEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newUrl) return;

    startTransition(async () => {
      try {
        const payload = {
          name: newName,
          url: newUrl,
          method: newMethod,
          intervalSeconds: Number(newInterval),
          timeoutMs: 5000,
          expectedStatusCodes: [200, 201, 204],
          assertions: [
            {
              target: 'latency_ms',
              operator: 'less_than',
              expectedValue: Number(newSlaMs),
            },
          ],
          tags: ['production'],
        };

        const res = await fetch('/api/endpoints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          setShowAddModal(false);
          setNewName('');
          setNewUrl('');
          await fetchEndpoints();
        }
      } catch (err) {
        console.error('Error creating endpoint:', err);
      }
    });
  };

  // Fleet KPIs
  const totalMonitors = endpoints.length;
  const activeMonitors = endpoints.filter((e) => e.isActive).length;
  const avgUptime =
    totalMonitors > 0
      ? (
          endpoints.reduce((acc, curr) => acc + curr.aggregates.uptimePercentage, 0) /
          totalMonitors
        ).toFixed(2)
      : '100.00';
  const avgFleetLatency =
    totalMonitors > 0
      ? (
          endpoints.reduce((acc, curr) => acc + curr.aggregates.avgLatencyMs, 0) /
          totalMonitors
        ).toFixed(0)
      : '0';

  return (
    <div className="min-h-screen bg-[#070a12] text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <header className="border-b border-slate-800/80 bg-[#0c1222]/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Activity className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
                  PulseTrack
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold tracking-wider bg-cyan-950 text-cyan-400 border border-cyan-800/50">
                  Clean Arch v1.0
                </span>
              </div>
              <p className="text-xs text-slate-400">Observabilidad & Uptime de APIs en Tiempo Real</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* SSE Live Status Pill */}
            <div
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono flex items-center gap-1.5 ${
                isConnected
                  ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-400'
                  : 'border-slate-800 bg-slate-900 text-slate-400'
              }`}
              title={isConnected ? 'Conectado al stream SSE de eventos en tiempo real' : 'Conectando stream SSE...'}
            >
              <Radio className={`w-3 h-3 ${isConnected ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
              <span>{isConnected ? 'SSE En Vivo' : 'SSE Offline'}</span>
            </div>

            <Link
              href="/status"
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:bg-slate-700/60 text-xs font-medium text-slate-300 flex items-center gap-1.5 transition"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Status Page</span>
            </Link>

            <button
              onClick={() => setShowAlertModal(true)}
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:bg-slate-700/60 text-xs font-medium text-slate-300 flex items-center gap-1.5 transition"
            >
              <Bell className="w-3.5 h-3.5 text-amber-400" />
              <span>Canales de Alerta</span>
            </button>

            <button
              onClick={() => {
                void fetchEndpoints();
                void fetchIncidents();
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:bg-slate-700/60 text-xs font-medium text-slate-300 flex items-center gap-2 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </button>

            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-xs font-semibold text-slate-950 flex items-center gap-2 shadow-md shadow-cyan-500/10 transition"
            >
              <Plus className="w-4 h-4 text-slate-950" />
              Nuevo Endpoint
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full space-y-8">
        {/* Fleet KPI Banner */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-[#0f172a]/90 border border-slate-800 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Monitores</span>
              <Server className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-white">{totalMonitors}</span>
              <span className="text-xs text-emerald-400">{activeMonitors} activos</span>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-[#0f172a]/90 border border-slate-800 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Uptime Global (24h)</span>
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-emerald-400">{avgUptime}%</span>
              <span className="text-xs text-slate-400">SLA Global</span>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-[#0f172a]/90 border border-slate-800 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Latencia Flota</span>
              <Zap className="w-5 h-5 text-amber-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-amber-300">{avgFleetLatency}</span>
              <span className="text-xs text-slate-400">ms promedio</span>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-[#0f172a]/90 border border-slate-800 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Motor de Sondeo</span>
              <Activity className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse-glow" />
              <span className="text-sm font-bold text-emerald-300">Activo con Jitter</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Pool de concurrencia: max 10 sockets</p>
          </div>
        </section>

        {/* Incidents & MTTR Card */}
        <section>
          <IncidentsCard
            activeIncidents={activeIncidents}
            recentResolved={recentResolved}
            mttrMinutes={mttrMinutes}
          />
        </section>

        {/* Monitored Endpoints List */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <span>Endpoints & APIs Supervisadas</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-slate-800 text-slate-400">
                {endpoints.length}
              </span>
            </h2>
          </div>

          {endpoints.length === 0 && !loading && (
            <div className="text-center py-16 px-4 border border-dashed border-slate-800 rounded-2xl bg-[#0f172a]/40">
              <Activity className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-300">No hay endpoints registrados</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Registra un endpoint para iniciar el monitoreo de latencia por fases de socket y disponibilidad en tiempo real.
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-4 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-white transition"
              >
                Registrar Endpoint
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-5">
            {endpoints.map((ep) => {
              const latest = ep.latestCheck;
              const status = latest?.status ?? 'UNKNOWN';

              const isHealthy = status === 'HEALTHY';
              const isDegraded = status === 'DEGRADED';
              const isDown = status === 'DOWN';

              const statusColor = isHealthy
                ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-400'
                : isDegraded
                ? 'border-amber-500/30 bg-amber-950/20 text-amber-400'
                : isDown
                ? 'border-red-500/30 bg-red-950/20 text-red-400'
                : 'border-slate-800 bg-slate-900 text-slate-400';

              const latency = latest?.latency;
              const totalLatency = latency ? latency.totalMs : 0;

              return (
                <div
                  key={ep.id}
                  className="rounded-2xl border border-slate-800 bg-[#0d1424] p-5 shadow-lg hover:border-slate-700 transition space-y-4"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Header info */}
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border flex items-center gap-1.5 ${statusColor}`}
                        >
                          {isHealthy && <CheckCircle2 className="w-3.5 h-3.5" />}
                          {isDegraded && <AlertTriangle className="w-3.5 h-3.5" />}
                          {isDown && <XCircle className="w-3.5 h-3.5" />}
                          <span>{status}</span>
                        </span>
                        <Link
                          href={`/endpoints/${ep.id}`}
                          className="text-base font-bold text-white hover:text-cyan-400 transition underline-offset-4 hover:underline truncate"
                        >
                          {ep.name}
                        </Link>
                        <button
                          onClick={() => handleToggleActive(ep)}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 transition ${
                            ep.isActive
                              ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-400 hover:bg-emerald-900/30'
                              : 'border-amber-500/30 bg-amber-950/20 text-amber-400 hover:bg-amber-900/30'
                          }`}
                          title={ep.isActive ? 'Pausar sondeo automático' : 'Reanudar sondeo automático'}
                        >
                          {ep.isActive ? <Play className="w-2.5 h-2.5" /> : <Pause className="w-2.5 h-2.5" />}
                          <span>{ep.isActive ? 'ACTIVO' : 'PAUSADO'}</span>
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-bold text-[10px]">
                          {ep.method}
                        </span>
                        <span className="text-slate-300 truncate">{ep.url}</span>
                        <span className="text-slate-500">•</span>
                        <span>Cada {ep.intervalSeconds}s</span>
                      </div>
                    </div>

                    {/* Stats & Actions */}
                    <div className="flex items-center gap-4 lg:gap-6">
                      <div className="text-right">
                        <div className="text-xs text-slate-400">Uptime 24h</div>
                        <div className="text-base font-bold text-emerald-400">
                          {ep.aggregates.uptimePercentage}%
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-xs text-slate-400">Latencia Total</div>
                        <div className="text-base font-bold text-amber-300">
                          {totalLatency > 0 ? `${totalLatency.toFixed(1)} ms` : '—'}
                        </div>
                      </div>

                      <div className="text-right hidden sm:block">
                        <div className="text-xs text-slate-400">p95 / p99</div>
                        <div className="text-xs font-mono text-slate-300">
                          {ep.aggregates.p95LatencyMs}ms / {ep.aggregates.p99LatencyMs}ms
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Export CSV link */}
                        <a
                          href={`/api/endpoints/${ep.id}/export?format=csv`}
                          download
                          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 transition"
                          title="Descargar telemetría CSV"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>

                        {/* Edit Button */}
                        <button
                          onClick={() =>
                            setEditingEndpoint({
                              id: ep.id,
                              name: ep.name,
                              url: ep.url,
                              method: ep.method,
                              intervalSeconds: ep.intervalSeconds,
                              timeoutMs: ep.timeoutMs,
                              isActive: ep.isActive,
                              tags: ep.tags,
                            })
                          }
                          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 transition"
                          title="Configuración de endpoint"
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => handleProbe(ep.id)}
                          disabled={probingId === ep.id}
                          className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 flex items-center gap-2 transition disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${probingId === ep.id ? 'animate-spin' : ''}`} />
                          <span>{probingId === ep.id ? 'Sondando...' : 'Sondar Ahora'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* BetterStack-Style Visual Uptime Bar */}
                  {ep.historyBuckets && ep.historyBuckets.length > 0 && (
                    <div className="pt-2">
                      <UptimeBar
                        buckets={ep.historyBuckets}
                        uptimePercentage={ep.aggregates.uptimePercentage}
                        timeframeLabel="Historial de Disponibilidad (24h)"
                      />
                    </div>
                  )}

                  {/* Telemetry Breakdown Bar */}
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

                      {/* Stacked latency bar */}
                      <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden flex shadow-inner">
                        <div
                          style={{ width: `${Math.max(2, (latency.dnsLookupMs / totalLatency) * 100)}%` }}
                          title={`DNS: ${latency.dnsLookupMs}ms`}
                          className="bg-indigo-500 h-full"
                        />
                        <div
                          style={{ width: `${Math.max(2, (latency.tcpConnectMs / totalLatency) * 100)}%` }}
                          title={`TCP Connect: ${latency.tcpConnectMs}ms`}
                          className="bg-cyan-500 h-full"
                        />
                        <div
                          style={{ width: `${Math.max(2, (latency.tlsHandshakeMs / totalLatency) * 100)}%` }}
                          title={`TLS Handshake: ${latency.tlsHandshakeMs}ms`}
                          className="bg-purple-500 h-full"
                        />
                        <div
                          style={{ width: `${Math.max(2, (latency.ttfbMs / totalLatency) * 100)}%` }}
                          title={`TTFB: ${latency.ttfbMs}ms`}
                          className="bg-emerald-500 h-full"
                        />
                        <div
                          style={{ width: `${Math.max(2, (latency.contentTransferMs / totalLatency) * 100)}%` }}
                          title={`Transfer: ${latency.contentTransferMs}ms`}
                          className="bg-amber-500 h-full"
                        />
                      </div>

                      {/* Legend */}
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

                      {/* Failed Assertions alert */}
                      {latest?.failedAssertions && latest.failedAssertions.length > 0 && (
                        <div className="mt-2 p-2 rounded-lg bg-amber-950/40 border border-amber-800/50 text-[11px] text-amber-300">
                          {latest.failedAssertions.map((err, idx) => (
                            <div key={idx} className="flex items-center gap-1.5">
                              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                              <span>{err}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Modal: New Endpoint */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[#0f172a] border border-slate-800 shadow-2xl p-6 space-y-5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-cyan-400" /> Registrar Nuevo Endpoint
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateEndpoint} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Nombre del Servicio / API</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Auth Gateway API"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">URL Objetivo (HTTP / HTTPS)</label>
                <input
                  type="url"
                  required
                  placeholder="https://api.empresa.com/health"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Método HTTP</label>
                  <select
                    value={newMethod}
                    onChange={(e) => setNewMethod(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="HEAD">HEAD</option>
                    <option value="OPTIONS">OPTIONS</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Intervalo (segundos)</label>
                  <input
                    type="number"
                    min={5}
                    value={newInterval}
                    onChange={(e) => setNewInterval(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">SLA Latencia Máxima (ms)</label>
                <input
                  type="number"
                  min={50}
                  step={50}
                  value={newSlaMs}
                  onChange={(e) => setNewSlaMs(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Si la latencia total supera este umbral, el estado cambiará automáticamente a DEGRADED.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold transition shadow-md"
                >
                  Guardar & Activar Monitoreo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Alert Channels Management */}
      <AlertChannelsModal
        isOpen={showAlertModal}
        onClose={() => setShowAlertModal(false)}
      />

      {/* Modal: Edit Endpoint Configuration */}
      <EditEndpointModal
        endpoint={editingEndpoint}
        isOpen={editingEndpoint !== null}
        onClose={() => setEditingEndpoint(null)}
        onSaved={fetchEndpoints}
        onDeleted={fetchEndpoints}
      />
    </div>
  );
}
