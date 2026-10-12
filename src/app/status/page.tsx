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

interface StatusPageData {
  globalStatus: 'OPERATIONAL' | 'DEGRADED' | 'OUTAGE';
  globalStatusMessage: string;
  updatedAt: string;
  services: PublicService[];
  activeIncidents: PublicIncident[];
  pastIncidents: PublicIncident[];
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

  const bannerColor = isOperational
    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
    : isDegraded
    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
    : 'bg-red-500/10 border-red-500/30 text-red-400';

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
              href="/"
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:bg-slate-700/60 text-xs font-medium text-slate-300 flex items-center gap-1.5 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Consola Interna</span>
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
              {isOutage && <XCircle className="w-6 h-6 text-red-400" />}
            </div>
            <div>
              <h2 className="text-xl font-extrabold tracking-tight text-white">
                {data?.globalStatusMessage ?? 'Verificando estado de la red...'}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Actualizado en tiempo real • {data ? new Date(data.updatedAt).toLocaleTimeString() : '—'}
              </p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/60 border border-slate-700 text-xs font-mono text-slate-300">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>SLA Garantizado 99.9%</span>
          </div>
        </section>

        {/* Active Incidents Banner (if any) */}
        {data && data.activeIncidents.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 animate-pulse" />
              <span>Incidentes Activos en Curso ({data.activeIncidents.length})</span>
            </h3>
            <div className="space-y-2">
              {data.activeIncidents.map((inc) => (
                <div
                  key={inc.id}
                  className="p-4 rounded-xl bg-red-950/20 border border-red-800/60 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white uppercase tracking-wider text-[11px]">
                      {inc.severity} OUTAGE
                    </span>
                    <span className="text-slate-400 font-mono text-[11px]">
                      Iniciado: {new Date(inc.startedAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-slate-300">{inc.summary}</p>
                  <p className="text-[11px] text-amber-300">
                    Nuestros ingenieros de guardia están investigando activamente y trabajando en la resolución.
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Component / Services Status List */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
              Servicios & APIs de Producción
            </h3>
            <span className="text-xs text-slate-400 font-mono">Disponibilidad 90 días</span>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0d1424] divide-y divide-slate-800/80 shadow-lg overflow-hidden">
            {data?.services.map((svc) => {
              const isHealthy = svc.currentStatus === 'HEALTHY';
              const isDegradedStatus = svc.currentStatus === 'DEGRADED';
              const isDown = svc.currentStatus === 'DOWN';

              return (
                <div key={svc.id} className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2.5 h-2.5 rounded-full ${
                          isHealthy
                            ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                            : isDegradedStatus
                            ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                            : isDown
                            ? 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                            : 'bg-slate-500'
                        }`}
                      />
                      <div>
                        <h4 className="text-sm font-bold text-white">{svc.name}</h4>
                        <span className="text-[11px] font-mono text-slate-400">
                          Latencia Promedio: {svc.avgLatencyMs.toFixed(0)} ms
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <div className="text-xs font-mono font-bold text-emerald-400">
                          {svc.uptime90d.toFixed(2)}%
                        </div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider">90 Días</div>
                      </div>

                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                          isHealthy
                            ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-400'
                            : isDegradedStatus
                            ? 'border-amber-500/30 bg-amber-950/20 text-amber-400'
                            : 'border-red-500/30 bg-red-950/20 text-red-400'
                        }`}
                      >
                        {isHealthy ? 'Operacional' : isDegradedStatus ? 'Degradado' : 'Caído'}
                      </span>
                    </div>
                  </div>

                  {/* 30-Pill Visual Availability Strip */}
                  <div className="flex items-center gap-[3px] h-3 bg-slate-900/60 p-0.5 rounded-lg border border-slate-800/80">
                    {svc.slots.length > 0 ? (
                      svc.slots.map((s, idx) => {
                        let col = 'bg-slate-700/40';
                        if (s.status === 'HEALTHY') col = 'bg-emerald-500';
                        else if (s.status === 'DEGRADED') col = 'bg-amber-500';
                        else if (s.status === 'DOWN') col = 'bg-red-500';

                        return (
                          <div
                            key={idx}
                            title={`${new Date(s.timestamp).toLocaleDateString()}: ${s.status} (${s.latencyMs.toFixed(0)}ms)`}
                            className={`flex-1 h-full rounded-[2px] transition hover:scale-y-125 ${col}`}
                          />
                        );
                      })
                    ) : (
                      <div className="w-full text-center text-[10px] text-slate-500 font-mono">
                        Historial reciente activo
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Past Incidents Archive */}
        <section className="space-y-4 pt-4 border-t border-slate-800">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400" />
            <span>Historial Reciente de Resoluciones</span>
          </h3>

          {data && data.pastIncidents.length > 0 ? (
            <div className="space-y-3 text-xs">
              {data.pastIncidents.map((inc) => (
                <div
                  key={inc.id}
                  className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                    <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Resuelto
                    </span>
                    <span>
                      {new Date(inc.startedAt).toLocaleDateString()} a las{' '}
                      {new Date(inc.startedAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <h4 className="font-bold text-slate-200">{inc.summary}</h4>
                  {inc.resolvedAt && (
                    <p className="text-[11px] text-slate-500">
                      Causa mitigada y tráfico restaurado el {new Date(inc.resolvedAt).toLocaleTimeString()}.
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">No se han registrado incidentes en los últimos 30 días.</p>
          )}
        </section>
      </main>

      {/* Public Footer */}
      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        <div className="max-w-4xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>Desarrollado con PulseTrack Observability Suite</span>
          <span className="font-mono text-[11px]">SLA Monitor • Powered by Clean Architecture</span>
        </div>
      </footer>
    </div>
  );
}
