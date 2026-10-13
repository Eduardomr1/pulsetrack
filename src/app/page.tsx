'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ShieldCheck,
  RefreshCw,
  Plus,
  Server,
  Zap,
  Bell,
  Radio,
} from 'lucide-react';
import { usePulseStream } from '@/hooks/use-pulse-stream';
import { IncidentsCard, ActiveIncidentItem, ResolvedIncidentItem } from '@/components/incidents-card';
import { AlertChannelsModal } from '@/components/alert-channels-modal';
import { EditEndpointModal, EndpointDataForEdit } from '@/components/edit-endpoint-modal';
import { ServiceStatusCard, ServiceCardData } from '@/components/service-status-card';
import { RegisterEndpointModal } from '@/components/register-endpoint-modal';

export default function DashboardPage() {
  const [endpoints, setEndpoints] = useState<ServiceCardData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showAlertModal, setShowAlertModal] = useState<boolean>(false);
  const [editingEndpoint, setEditingEndpoint] = useState<EndpointDataForEdit | null>(null);

  // Incidents & MTTR state
  const [activeIncidents, setActiveIncidents] = useState<ActiveIncidentItem[]>([]);
  const [recentResolved, setRecentResolved] = useState<ResolvedIncidentItem[]>([]);
  const [mttrMinutes, setMttrMinutes] = useState<number>(0);

  const handleToggleActive = async (ep: ServiceCardData) => {
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

  // SSE Live Pulse Stream
  const { isConnected, latestPulse } = usePulseStream({ enabled: true });

  const fetchEndpoints = async () => {
    try {
      const res = await fetch('/api/endpoints');
      const json = await res.json();
      if (json.success) {
        // Fetch 24h history for each endpoint for the BetterStack-style bar and sparklines
        const enriched = await Promise.all(
          json.data.map(async (ep: ServiceCardData) => {
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

  const handleEditEndpoint = (ep: ServiceCardData) => {
    setEditingEndpoint({
      id: ep.id,
      name: ep.name,
      url: ep.url,
      method: ep.method,
      intervalSeconds: ep.intervalSeconds,
      timeoutMs: ep.timeoutMs,
      isActive: ep.isActive,
      tags: ep.tags,
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
                <h1 className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
                  PulseTrack
                </h1>
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
        <section aria-label="Métricas de la Flota" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <h2 className="sr-only">Métricas Clave de la Flota</h2>
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

          {/* Tarjetas de estado en vivo con badges animados y sparklines */}
          <div className="grid grid-cols-1 gap-5">
            {endpoints.map((ep) => (
              <ServiceStatusCard
                key={ep.id}
                service={ep}
                isProbing={probingId === ep.id}
                onProbe={handleProbe}
                onToggleActive={handleToggleActive}
                onEdit={handleEditEndpoint}
              />
            ))}
          </div>
        </section>
      </main>

      {/* Modal Accesible: Registrar Nuevo Endpoint con selector de intervalo y método HTTP */}
      <RegisterEndpointModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={fetchEndpoints}
      />

      {/* Modal: Gestión de Canales de Alerta */}
      <AlertChannelsModal
        isOpen={showAlertModal}
        onClose={() => setShowAlertModal(false)}
      />

      {/* Modal: Configuración / Edición de Endpoint */}
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
