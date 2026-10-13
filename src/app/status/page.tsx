'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Activity,
  ArrowLeft,
  Clock,
  Shield,
  RefreshCw,
  Calendar,
  ShieldAlert,
} from 'lucide-react';

interface PublicSlot {
  timestamp: string;
  status: string;
  latencyMs: number;
}

interface PublicService {
  id: string;
  name: string;
  url: string;
  tags: string[];
  currentStatus: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
  uptime24h: number;
  uptime90d: number;
  avgLatencyMs: number;
  slots: PublicSlot[];
}

interface PublicIncident {
  id: string;
  endpointId: string;
  severity: string;
  summary: string;
  startedAt: string;
  resolvedAt?: string | null;
}

interface PublicMaintenance {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';
}

interface StatusPageData {
  globalStatus: 'OPERATIONAL' | 'DEGRADED' | 'OUTAGE' | 'MAINTENANCE';
  globalStatusMessage: string;
  updatedAt: string;
  services: PublicService[];
  activeIncidents: PublicIncident[];
  pastIncidents: PublicIncident[];
  maintenance?: PublicMaintenance[];
}

export default function PublicStatusPage() {
  const [data, setData] = useState<StatusPageData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/status');
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } catch (err) {
      console.error('Error fetching status page:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const isOperational = data?.globalStatus === 'OPERATIONAL';
  const isDegraded = data?.globalStatus === 'DEGRADED';
  const isOutage = data?.globalStatus === 'OUTAGE';
  const isMaintenance = data?.globalStatus === 'MAINTENANCE';

  const bannerColor = isOperational
    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
    : isDegraded
    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
    : isMaintenance
    ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
    : 'bg-red-500/10 border-red-500/30 text-red-400';

  const activeOrUpcomingMaint = data?.maintenance?.filter(
    (m) => m.status === 'IN_PROGRESS' || m.status === 'SCHEDULED'
  );

  return (
    <div className="min-h-screen bg-[#070a12] text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-white">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-[#0c1222]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                PulseTrack Status
              </h1>
              <p className="text-[11px] text-slate-400">Página Pública de Disponibilidad & Servicios</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => void fetchStatus()}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Refrescar estado"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <Link
              href="/incidents"
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:bg-slate-700/60 text-xs font-medium text-slate-300 flex items-center gap-1.5 transition"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
              <span>Incidentes</span>
            </Link>
            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:bg-slate-700/60 text-xs font-medium text-slate-300 flex items-center gap-1.5 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Consola</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto px-4 py-8 flex-1 w-full space-y-8">
        {/* Global Health Status Banner */}
        <section
          className={`p-6 rounded-2xl border ${bannerColor} shadow-xl flex items-center justify-between gap-4 transition-all`}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-900/60 flex items-center justify-center border border-current">
              {isOperational && <CheckCircle2 className="w-6 h-6 text-emerald-400" />}
              {isDegraded && <AlertTriangle className="w-6 h-6 text-amber-400" />}
              {isMaintenance && <Calendar className="w-6 h-6 text-cyan-400" />}
              {isOutage && <XCircle className="w-6 h-6 text-red-400" />}
            </div>
            <div>
              <h2 className="text-xl font-extrabold tracking-tight text-white">
                {data?.globalStatusMessage ?? 'Verificando estado de la red...'}
              </h2>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-slate-500" />
                <span>
                  Última sincronización:{' '}
                  {data?.updatedAt ? new Date(data.updatedAt).toLocaleTimeString() : '...'}
                </span>
              </p>
            </div>
          </div>
        </section>

        {/* Scheduled Maintenance Notice Banner */}
        {activeOrUpcomingMaint && activeOrUpcomingMaint.length > 0 && (
          <section className="space-y-3">
            {activeOrUpcomingMaint.map((m) => {
              const inProgress = m.status === 'IN_PROGRESS';
              return (
                <div
                  key={m.id}
                  className={`p-4 rounded-xl border space-y-2 ${
                    inProgress
                      ? 'border-cyan-500/50 bg-cyan-950/20 text-cyan-300'
                      : 'border-amber-500/40 bg-amber-950/20 text-amber-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider">
                      <Calendar className="w-4 h-4" />
                      {inProgress ? 'Mantenimiento Preventivo en Curso' : 'Mantenimiento Programado'}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      {new Date(m.startTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} - {new Date(m.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <h4 className="font-bold text-white text-sm">{m.title}</h4>
                  {m.description && <p className="text-xs text-slate-300">{m.description}</p>}
                </div>
              );
            })}
          </section>
        )}

        {/* Active Incidents Section */}
        {data?.activeIncidents && data.activeIncidents.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span>Incidencias en Curso</span>
            </h3>

            <div className="space-y-3">
              {data.activeIncidents.map((inc) => (
                <div
                  key={inc.id}
                  className="p-4 rounded-xl border border-red-500/40 bg-red-950/20 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                      {inc.summary}
                    </span>
                    <span className="text-[10px] font-mono text-red-400 uppercase font-bold">
                      {inc.severity}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Detectado el {new Date(inc.startedAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Services Status & 90-Day BetterStack-Style Strip */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Shield className="w-4 h-4 text-cyan-400" />
              <span>Salud de Componentes & APIs ({data?.services.length ?? 0})</span>
            </h3>
            <span className="text-[11px] font-mono text-slate-500">Historial de Disponibilidad</span>
          </div>

          <div className="space-y-4">
            {data?.services.map((svc) => {
              const isSvcHealthy = svc.currentStatus === 'HEALTHY';
              const isSvcDegraded = svc.currentStatus === 'DEGRADED';
              const isSvcDown = svc.currentStatus === 'DOWN';

              const badgeColor = isSvcHealthy
                ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-400'
                : isSvcDegraded
                ? 'border-amber-500/30 bg-amber-950/20 text-amber-400'
                : isSvcDown
                ? 'border-red-500/30 bg-red-950/20 text-red-400'
                : 'border-slate-800 bg-slate-900 text-slate-400';

              return (
                <div
                  key={svc.id}
                  className="p-5 rounded-2xl border border-slate-800 bg-[#0d1424] space-y-4 shadow-md hover:border-slate-700 transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h4 className="font-bold text-white text-base">{svc.name}</h4>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeColor}`}>
                          {svc.currentStatus}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 truncate block mt-0.5">
                        {svc.url}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-mono">
                      <div className="text-right">
                        <span className="text-[10px] uppercase text-slate-500 block">24 Horas</span>
                        <span className="font-bold text-emerald-400">{svc.uptime24h}%</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] uppercase text-slate-500 block">90 Días</span>
                        <span className="font-bold text-cyan-300">{svc.uptime90d}%</span>
                      </div>
                    </div>
                  </div>

                  {/* 30-Day Strip Simulation */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center gap-1 h-7">
                      {svc.slots && svc.slots.length > 0 ? (
                        svc.slots.map((slot, idx) => {
                          const slotHealthy = slot.status === 'HEALTHY';
                          const slotDegraded = slot.status === 'DEGRADED';
                          const slotDown = slot.status === 'DOWN';

                          const slotColor = slotHealthy
                            ? 'bg-emerald-500 hover:bg-emerald-400'
                            : slotDegraded
                            ? 'bg-amber-500 hover:bg-amber-400'
                            : slotDown
                            ? 'bg-red-500 hover:bg-red-400'
                            : 'bg-slate-700';

                          return (
                            <div
                              key={idx}
                              title={`${new Date(slot.timestamp).toLocaleDateString()}: ${slot.status} (${slot.latencyMs.toFixed(0)}ms)`}
                              className={`flex-1 h-full rounded-sm transition-all cursor-pointer ${slotColor}`}
                            />
                          );
                        })
                      ) : (
                        Array.from({ length: 30 }).map((_, idx) => (
                          <div
                            key={idx}
                            title="Operación normal"
                            className="flex-1 h-full rounded-sm bg-emerald-500/80 hover:bg-emerald-400 transition"
                          />
                        ))
                      )}
                    </div>
                    <div className="flex justify-between text-[10px] font-mono text-slate-500">
                      <span>Hace 30 días</span>
                      <span>Hoy</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Past Resolved Incidents Changelog */}
        {data?.pastIncidents && data.pastIncidents.length > 0 && (
          <section className="space-y-4 pt-4 border-t border-slate-800/80">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
              Historial de Incidentes Resueltos
            </h3>

            <div className="space-y-3">
              {data.pastIncidents.map((p) => (
                <div key={p.id} className="p-4 rounded-xl border border-slate-800 bg-[#0d1424] text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-200">{p.summary}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400">
                      RESUELTO
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-slate-500 font-mono">
                    <span>Inició: {new Date(p.startedAt).toLocaleDateString()}</span>
                    {p.resolvedAt && <span>Resuelto: {new Date(p.resolvedAt).toLocaleDateString()}</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-[#0c1222]/80 py-6 text-center text-xs text-slate-500">
        <p>Monitorizado continuamente por <strong>PulseTrack</strong> • Clean Architecture Observability Engine</p>
      </footer>
    </div>
  );
}
