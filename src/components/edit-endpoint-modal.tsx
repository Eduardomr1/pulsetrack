'use client';

import React, { useState } from 'react';
import { Settings, Trash2, PauseCircle, PlayCircle } from 'lucide-react';

export interface EndpointDataForEdit {
  id: string;
  name: string;
  url: string;
  method: string;
  intervalSeconds: number;
  timeoutMs: number;
  isActive: boolean;
  tags?: string[];
  slaThresholdMs?: number;
}

interface EditEndpointModalProps {
  endpoint: EndpointDataForEdit | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

export function EditEndpointModal({
  endpoint,
  isOpen,
  onClose,
  onSaved,
  onDeleted,
}: EditEndpointModalProps) {
  const [name, setName] = useState(endpoint?.name ?? '');
  const [url, setUrl] = useState(endpoint?.url ?? '');
  const [method, setMethod] = useState(endpoint?.method ?? 'GET');
  const [intervalSeconds, setIntervalSeconds] = useState(endpoint?.intervalSeconds ?? 30);
  const [timeoutMs, setTimeoutMs] = useState(endpoint?.timeoutMs ?? 5000);
  const [isActive, setIsActive] = useState(endpoint?.isActive ?? true);
  const [slaMs, setSlaMs] = useState(endpoint?.slaThresholdMs ?? 500);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  React.useEffect(() => {
    if (endpoint) {
      setName(endpoint.name);
      setUrl(endpoint.url);
      setMethod(endpoint.method);
      setIntervalSeconds(endpoint.intervalSeconds);
      setTimeoutMs(endpoint.timeoutMs);
      setIsActive(endpoint.isActive);
      setSlaMs(endpoint.slaThresholdMs ?? 500);
      setConfirmDelete(false);
      setErrorMsg(null);
    }
  }, [endpoint]);

  if (!isOpen || !endpoint) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setErrorMsg(null);

      const assertions = [
        {
          target: 'latency_ms',
          operator: 'less_than',
          expectedValue: slaMs,
        },
      ];

      const res = await fetch(`/api/endpoints/${endpoint.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          url,
          method,
          intervalSeconds,
          timeoutMs,
          isActive,
          assertions,
        }),
      });

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error ?? 'Error al actualizar endpoint');
      }

      onSaved();
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al guardar cambios');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      setDeleting(true);
      setErrorMsg(null);

      const res = await fetch(`/api/endpoints/${endpoint.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error ?? 'Error al eliminar endpoint');
      }

      onDeleted();
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al eliminar endpoint');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-[#0f172a] border border-slate-800 shadow-2xl p-6 space-y-5 animate-in fade-in duration-200">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Settings className="w-4 h-4 text-cyan-400" /> Configuración de Endpoint
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition">
            ✕
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/50 text-xs text-red-300">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-300 mb-1">Nombre del Endpoint</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-300 mb-1">URL Objetivo</label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500 font-mono text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-300 mb-1">Método HTTP</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
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
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-300 mb-1">SLA Latencia Máxima (ms)</label>
              <input
                type="number"
                min={50}
                step={50}
                value={slaMs}
                onChange={(e) => setSlaMs(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-300 mb-1">Timeout Socket (ms)</label>
              <input
                type="number"
                min={500}
                step={500}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Pause / Resume switch */}
          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="font-bold text-white flex items-center gap-1.5">
                {isActive ? (
                  <PlayCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <PauseCircle className="w-4 h-4 text-amber-400" />
                )}
                <span>Estado del Sondeo Automático</span>
              </span>
              <p className="text-[11px] text-slate-400">
                {isActive
                  ? 'Activo: Se ejecutan sondeos continuos con jitter.'
                  : 'Pausado: El sondeo automático está detenido.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                isActive
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40'
                  : 'bg-amber-950 text-amber-400 border border-amber-500/40'
              }`}
            >
              {isActive ? 'Activo' : 'Pausado'}
            </button>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            {/* Delete button or confirmation */}
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition"
                >
                  {deleting ? 'Eliminando...' : 'Confirmar Eliminación'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-2 py-1.5 text-slate-400 hover:text-slate-200 text-xs"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-red-400 hover:text-red-300 font-semibold flex items-center gap-1.5 text-xs transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Eliminar Endpoint</span>
              </button>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition"
              >
                Cerrar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold transition shadow-md disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
