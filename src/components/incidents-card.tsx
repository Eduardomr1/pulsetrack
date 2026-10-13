import Link from 'next/link';
import { AlertTriangle, CheckCircle, Clock, ChevronRight } from 'lucide-react';

export interface ActiveIncidentItem {
  id: string;
  endpointId: string;
  endpointName: string;
  status: string;
  severity: string;
  startedAt: string;
  durationMinutes: number;
  summary: string;
  consecutiveFailures: number;
}

export interface ResolvedIncidentItem {
  id: string;
  endpointId: string;
  endpointName: string;
  status: string;
  severity: string;
  startedAt: string;
  resolvedAt: string | null;
  durationMinutes: number;
  summary: string;
}

interface IncidentsCardProps {
  activeIncidents: ActiveIncidentItem[];
  recentResolved: ResolvedIncidentItem[];
  mttrMinutes: number;
}

export function IncidentsCard({
  activeIncidents,
  recentResolved,
  mttrMinutes,
}: IncidentsCardProps) {
  const hasActive = activeIncidents.length > 0;

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0d1424] p-5 shadow-lg space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-3 h-3 rounded-full ${
              hasActive
                ? 'bg-red-500 animate-ping'
                : 'bg-emerald-400'
            }`}
          />
          <h2 id="incidents-heading" className="text-sm font-bold text-slate-100 flex items-center gap-2">
            Gestión de Incidentes & MTTR
            {hasActive && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-950 text-red-300 border border-red-800">
                {activeIncidents.length} Activo(s)
              </span>
            )}
          </h2>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
          <Clock className="w-3.5 h-3.5 text-cyan-400" />
          <span>MTTR Promedio:</span>
          <span className="font-bold text-cyan-300">{mttrMinutes} min</span>
        </div>
      </div>

      {/* Active Incidents */}
      {hasActive ? (
        <div className="space-y-2.5">
          {activeIncidents.map((inc) => (
            <div
              key={inc.id}
              className="p-3.5 rounded-xl bg-red-950/20 border border-red-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <span className="font-bold text-white">{inc.endpointName}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-900 text-red-200 font-mono">
                    {inc.severity}
                  </span>
                </div>
                <p className="text-slate-300 text-[11px] pl-6">{inc.summary}</p>
              </div>

              <div className="flex items-center gap-4 text-[11px] font-mono text-slate-400 pl-6 sm:pl-0">
                <div>
                  Duración:{' '}
                  <span className="font-bold text-red-300">{inc.durationMinutes} min</span>
                </div>
                <div>
                  Reintentos:{' '}
                  <span className="font-bold text-slate-200">{inc.consecutiveFailures}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-950/10 border border-emerald-900/30 text-xs text-emerald-400">
          <CheckCircle className="w-4 h-4 flex-shrink-0 text-emerald-400" />
          <span>Todos los sistemas operando con normalidad. Cero incidentes activos.</span>
        </div>
      )}

      {/* Recent Resolved Incidents */}
      {recentResolved.length > 0 && (
        <div className="space-y-1.5 pt-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
            Incidentes Recientes Resueltos
          </h3>
          <div className="divide-y divide-slate-800/60 text-xs">
            {recentResolved.slice(0, 3).map((res) => (
              <div key={res.id} className="py-2 flex items-center justify-between text-slate-300">
                <div className="flex items-center gap-2 truncate">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  <span className="font-medium text-slate-200 truncate">{res.endpointName}</span>
                  <span className="text-slate-400 text-[11px]">• {res.summary}</span>
                </div>
                <div className="text-[11px] font-mono text-slate-400 flex-shrink-0 ml-2">
                  Resuelto en {res.durationMinutes}m
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Command Center Link */}
      <div className="pt-2 border-t border-slate-800/80 flex justify-end">
        <Link
          href="/incidents"
          className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition"
        >
          <span>Abrir Centro de Comando de Incidentes</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
