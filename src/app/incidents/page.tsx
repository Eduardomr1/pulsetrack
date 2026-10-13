'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowLeft,
  RefreshCw,
  Flame,
  FileText,
  MessageSquare,
  ShieldAlert,
  Calendar,
  Check,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { IncidentTimelineEvent } from '@/core/domain/entities/incident.entity';

interface IncidentItem {
  id: string;
  endpointId: string;
  endpointName: string;
  targetUrl: string;
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED';
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  summary: string;
  rootCause: string | null;
  startedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  durationMinutes: number;
  timeToAcknowledgeMinutes: number | null;
  consecutiveFailures: number;
  timeline: IncidentTimelineEvent[];
}

interface MaintenanceItem {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';
  affectedEndpoints: string[];
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceItem[]>([]);
  const [mttrMinutes, setMttrMinutes] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'INVESTIGATING' | 'RESOLVED'>('ALL');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING'>('ALL');

  // Selected Incident for detail view/timeline
  const [selectedIncident, setSelectedIncident] = useState<IncidentItem | null>(null);

  // Action states
  const [noteText, setNoteText] = useState('');
  const [authorName, setAuthorName] = useState('On-Call SRE');
  const [rootCauseText, setRootCauseText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Maintenance form modal
  const [showMaintModal, setShowMaintModal] = useState(false);
  const [maintTitle, setMaintTitle] = useState('');
  const [maintDesc, setMaintDesc] = useState('');
  const [maintStart, setMaintStart] = useState('');
  const [maintEnd, setMaintEnd] = useState('');

  const fetchIncidents = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/incidents');
      const json = await res.json();
      if (json.success) {
        const all: IncidentItem[] = [
          ...json.data.activeIncidents,
          ...json.data.recentResolved,
        ];
        setIncidents(all);
        setMttrMinutes(json.data.summary.mttrMinutes);
        if (selectedIncident) {
          const updated = all.find((i) => i.id === selectedIncident.id);
          if (updated) setSelectedIncident(updated);
        }
      }

      // Fetch maintenance
      const mRes = await fetch('/api/maintenance');
      const mJson = await mRes.json();
      if (mJson.success) {
        setMaintenance(mJson.data);
      }
    } catch (err) {
      console.error('Error fetching incidents:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchIncidents();
  }, []);

  const handleAction = async (action: 'ACKNOWLEDGE' | 'ADD_NOTE' | 'RESOLVE') => {
    if (!selectedIncident) return;
    try {
      setSubmitting(true);
      const payload: Record<string, unknown> = {
        action,
        author: authorName,
      };

      if (action === 'ADD_NOTE') {
        if (!noteText.trim()) return;
        payload.message = noteText.trim();
      } else if (action === 'RESOLVE') {
        payload.rootCause = rootCauseText.trim() || undefined;
      }

      const res = await fetch(`/api/incidents/${selectedIncident.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (json.success) {
        setNoteText('');
        setRootCauseText('');
        await fetchIncidents();
      }
    } catch (err) {
      console.error('Error executing incident action:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: maintTitle,
          description: maintDesc,
          startTime: maintStart,
          endTime: maintEnd,
          affectedEndpoints: ['*'],
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowMaintModal(false);
        setMaintTitle('');
        setMaintDesc('');
        setMaintStart('');
        setMaintEnd('');
        void fetchIncidents();
      }
    } catch (err) {
      console.error('Error creating maintenance window:', err);
    }
  };

  const filteredIncidents = incidents.filter((i) => {
    if (statusFilter !== 'ALL' && i.status !== statusFilter) return false;
    if (severityFilter !== 'ALL' && i.severity !== severityFilter) return false;
    return true;
  });

  const activeCount = incidents.filter((i) => i.status === 'OPEN' || i.status === 'INVESTIGATING').length;

  return (
    <div className="min-h-screen bg-[#070a12] text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-white">
      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-[#0c1222]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
                <ShieldAlert className="w-5 h-5 text-red-400" />
                <h1 className="font-bold text-lg text-white">Centro de Comando de Incidentes</h1>
                {activeCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-950 text-red-400 border border-red-500/40 animate-pulse">
                    {activeCount} ACTIVO{activeCount > 1 ? 'S' : ''}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Gestión, reconocimiento, bitácora de auditoría y post-mortems automatizados
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowMaintModal(true)}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-cyan-300 border border-slate-700 flex items-center gap-2 transition"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Programar Mantenimiento</span>
            </button>

            <Link
              href="/status"
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 border border-slate-700 flex items-center gap-2 transition"
            >
              <span>Status Page Pública</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>

            <button
              onClick={fetchIncidents}
              disabled={loading}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
              title="Actualizar datos"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8 flex-1 w-full space-y-8">
        {/* SRE Metrics Ribbon */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-5 rounded-2xl bg-[#0f172a] border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold uppercase text-slate-400 block">Incidentes Activos</span>
              <div className="text-3xl font-extrabold text-red-400 mt-1">{activeCount}</div>
            </div>
            <Flame className="w-8 h-8 text-red-500/30" />
          </div>

          <div className="p-5 rounded-2xl bg-[#0f172a] border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold uppercase text-slate-400 block">MTTR Medio (24h)</span>
              <div className="text-3xl font-extrabold text-amber-300 mt-1">
                {mttrMinutes} <span className="text-sm font-normal text-slate-400">minutos</span>
              </div>
            </div>
            <Clock className="w-8 h-8 text-amber-500/30" />
          </div>

          <div className="p-5 rounded-2xl bg-[#0f172a] border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold uppercase text-slate-400 block">Ventanas de Mantenimiento</span>
              <div className="text-3xl font-extrabold text-cyan-400 mt-1">{maintenance.length}</div>
            </div>
            <Calendar className="w-8 h-8 text-cyan-500/30" />
          </div>
        </section>

        {/* Filter Bar */}
        <section className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-[#0d1424] border border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold mr-2">Estado:</span>
            {(['ALL', 'OPEN', 'INVESTIGATING', 'RESOLVED'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  statusFilter === st
                    ? 'bg-cyan-500 text-slate-950 shadow'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white'
                }`}
              >
                {st === 'ALL' ? 'Todos' : st}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold mr-2">Severidad:</span>
            {(['ALL', 'CRITICAL', 'WARNING'] as const).map((sev) => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  severityFilter === sev
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white'
                }`}
              >
                {sev === 'ALL' ? 'Todas' : sev}
              </button>
            ))}
          </div>
        </section>

        {/* Two Column Layout: Incident List & Selected Timeline */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Incident List (Left Column) */}
          <div className="lg:col-span-7 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
              Historial de Incidentes ({filteredIncidents.length})
            </h3>

            {filteredIncidents.length === 0 && !loading && (
              <div className="text-center py-16 px-4 border border-dashed border-slate-800 rounded-2xl bg-[#0f172a]/40">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                <h4 className="text-base font-semibold text-slate-300">Sin incidentes registrados</h4>
                <p className="text-xs text-slate-500 mt-1">
                  Todos los endpoints supervisados operan dentro de los umbrales de SLA normales.
                </p>
              </div>
            )}

            <div className="space-y-3">
              {filteredIncidents.map((inc) => {
                const isSelected = selectedIncident?.id === inc.id;
                const isOpen = inc.status === 'OPEN';
                const isInvestigating = inc.status === 'INVESTIGATING';
                const isResolved = inc.status === 'RESOLVED';

                return (
                  <div
                    key={inc.id}
                    onClick={() => setSelectedIncident(inc)}
                    className={`p-4 rounded-xl border transition cursor-pointer space-y-3 ${
                      isSelected
                        ? 'border-cyan-500 bg-[#101b33] shadow-lg'
                        : 'border-slate-800 bg-[#0d1424] hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${
                            isOpen
                              ? 'border-red-500/40 bg-red-950/40 text-red-400'
                              : isInvestigating
                              ? 'border-amber-500/40 bg-amber-950/40 text-amber-400'
                              : 'border-emerald-500/40 bg-emerald-950/40 text-emerald-400'
                          }`}
                        >
                          {isOpen && <Flame className="w-3 h-3" />}
                          {isInvestigating && <AlertTriangle className="w-3 h-3" />}
                          {isResolved && <Check className="w-3 h-3" />}
                          <span>{inc.status}</span>
                        </span>

                        <span className="text-xs font-bold text-white truncate max-w-[200px]">
                          {inc.endpointName}
                        </span>
                      </div>

                      <span className="text-[11px] font-mono text-slate-400">
                        {new Date(inc.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 font-mono line-clamp-2">
                      {inc.summary}
                    </p>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-[11px] text-slate-400">
                      <div className="flex items-center gap-3">
                        <span>
                          Duración: <strong className="text-slate-200">{inc.durationMinutes} min</strong>
                        </span>
                        {inc.timeToAcknowledgeMinutes !== null && (
                          <span>
                            TTA: <strong className="text-slate-200">{inc.timeToAcknowledgeMinutes}m</strong>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 text-cyan-400 font-semibold text-xs">
                        <span>Ver Bitácora</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Incident Detail & Timeline Command Drawer (Right Column) */}
          <div className="lg:col-span-5">
            {selectedIncident ? (
              <div className="rounded-2xl border border-slate-800 bg-[#0d1424] p-5 shadow-xl space-y-5 sticky top-24">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                  <div>
                    <h3 className="font-bold text-base text-white">Detalle de Incidente</h3>
                    <span className="text-[11px] font-mono text-slate-400">ID: {selectedIncident.id}</span>
                  </div>

                  <a
                    href={`/api/incidents/${selectedIncident.id}/post-mortem`}
                    download
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-cyan-300 border border-slate-700 flex items-center gap-1.5 transition"
                    title="Descargar reporte Post-Mortem en Markdown"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Post-Mortem</span>
                  </a>
                </div>

                {/* Status transitions action buttons */}
                <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
                  <span className="text-xs font-semibold text-slate-300 block">Acciones de Mando</span>
                  <div className="flex flex-wrap gap-2">
                    {selectedIncident.status === 'OPEN' && (
                      <button
                        onClick={() => handleAction('ACKNOWLEDGE')}
                        disabled={submitting}
                        className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition disabled:opacity-50"
                      >
                        Reconocer Incidente (Ack)
                      </button>
                    )}

                    {selectedIncident.status !== 'RESOLVED' && (
                      <button
                        onClick={() => handleAction('RESOLVE')}
                        disabled={submitting}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition disabled:opacity-50"
                      >
                        Marcar como Resuelto
                      </button>
                    )}
                  </div>

                  {selectedIncident.status !== 'RESOLVED' && (
                    <div className="space-y-1.5 pt-2">
                      <label className="text-[11px] text-slate-400 block">Causa Raíz (Opcional para cierre):</label>
                      <input
                        type="text"
                        placeholder="e.g. Saturation of DB connection pool"
                        value={rootCauseText}
                        onChange={(e) => setRootCauseText(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  )}
                </div>

                {/* Add Timeline Note Box */}
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Añadir Actualización a la Bitácora</span>
                  </span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. Reiniciando pods de API en clúster..."
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      onClick={() => handleAction('ADD_NOTE')}
                      disabled={submitting || !noteText.trim()}
                      className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs transition disabled:opacity-50"
                    >
                      Enviar
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <span>Autor:</span>
                    <input
                      type="text"
                      value={authorName}
                      onChange={(e) => setAuthorName(e.target.value)}
                      className="bg-transparent border-b border-slate-700 text-cyan-400 focus:outline-none px-1"
                    />
                  </div>
                </div>

                {/* Chronological Timeline */}
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                    Bitácora Cronológica de Eventos
                  </span>

                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {selectedIncident.timeline.map((ev) => (
                      <div
                        key={ev.id}
                        className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-bold text-cyan-400">{ev.author ?? 'SRE'}</span>
                          <span className="font-mono text-slate-500">
                            {new Date(ev.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-slate-300">{ev.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center text-slate-500 text-xs">
                Selecciona un incidente de la lista para ver su bitácora de auditoría, gestionar acciones de guardia o descargar el post-mortem.
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Modal: Schedule Maintenance Window */}
      {showMaintModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[#0f172a] border border-slate-800 p-6 space-y-5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Calendar className="w-4 h-4 text-cyan-400" /> Programar Mantenimiento Preventivo
              </h3>
              <button onClick={() => setShowMaintModal(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateMaintenance} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Título de la Operación</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Migración de Base de Datos y Parches de SO"
                  value={maintTitle}
                  onChange={(e) => setMaintTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Descripción / Alcance</label>
                <textarea
                  rows={2}
                  placeholder="Se esperan microcortes de hasta 2 minutos durante el reinicio de réplicas."
                  value={maintDesc}
                  onChange={(e) => setMaintDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Fecha y Hora de Inicio</label>
                  <input
                    type="datetime-local"
                    required
                    value={maintStart}
                    onChange={(e) => setMaintStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Fecha y Hora de Fin</label>
                  <input
                    type="datetime-local"
                    required
                    value={maintEnd}
                    onChange={(e) => setMaintEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowMaintModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold transition shadow-md"
                >
                  Confirmar Mantenimiento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
