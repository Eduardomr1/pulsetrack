'use client';

import React, { useState, useEffect } from 'react';
import { Bell, Plus, Trash2, Send, CheckCircle2, AlertCircle } from 'lucide-react';

export interface AlertChannelItem {
  id: string;
  name: string;
  type: 'WEBHOOK' | 'SLACK' | 'DISCORD';
  config: {
    webhookUrl: string;
    secretKey?: string;
    channel?: string;
    mentionRoleId?: string;
  };
  events: string[];
  isEnabled: boolean;
  createdAt: string;
}

interface AlertChannelsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AlertChannelsModal({ isOpen, onClose }: AlertChannelsModalProps) {
  const [channels, setChannels] = useState<AlertChannelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);

  // Form State
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'WEBHOOK' | 'SLACK' | 'DISCORD'>('SLACK');
  const [newUrl, setNewUrl] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchChannels = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/alert-channels');
      const json = await res.json();
      if (json.success) {
        setChannels(json.data);
      }
    } catch (err) {
      console.error('Error fetching alert channels:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchChannels();
    }
  }, [isOpen]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newUrl) return;

    try {
      setIsSubmitting(true);
      const config: Record<string, unknown> = { webhookUrl: newUrl };
      if (newType === 'WEBHOOK' && newSecret) {
        config.secretKey = newSecret;
      }

      const res = await fetch('/api/alert-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          type: newType,
          config,
          events: ['DOWN', 'DEGRADED', 'RECOVERED'],
          isEnabled: true,
        }),
      });

      if (res.ok) {
        setNewName('');
        setNewUrl('');
        setNewSecret('');
        await fetchChannels();
      }
    } catch (err) {
      console.error('Error creating channel:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/alert-channels/${id}`, { method: 'DELETE' });
      await fetchChannels();
    } catch (err) {
      console.error('Error deleting channel:', err);
    }
  };

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    try {
      await fetch(`/api/alert-channels/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: !currentEnabled }),
      });
      await fetchChannels();
    } catch (err) {
      console.error('Error toggling channel:', err);
    }
  };

  const handleTest = async (id: string) => {
    try {
      setTestingId(id);
      setTestResult(null);
      const res = await fetch(`/api/alert-channels/${id}/test`, { method: 'POST' });
      const json = await res.json();

      setTestResult({
        id,
        success: json.success,
        message: json.success
          ? 'Notificación de prueba enviada con éxito'
          : json.error ?? 'Fallo al entregar la alerta',
      });
    } catch (err: unknown) {
      setTestResult({
        id,
        success: false,
        message: err instanceof Error ? err.message : 'Error al probar alerta',
      });
    } finally {
      setTestingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-[#0f172a] border border-slate-800 shadow-2xl p-6 space-y-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-950 border border-cyan-800 flex items-center justify-center text-cyan-400">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Canales de Alerta de Incidentes</h3>
              <p className="text-xs text-slate-400">
                Notifica automáticamente a Webhooks, Slack y Discord ante caídas y recuperaciones
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition font-mono text-sm"
          >
            ✕
          </button>
        </div>

        {/* Channels List */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Canales Configurados ({channels.length})
          </h4>

          {loading && <p className="text-xs text-slate-500 py-2">Cargando canales...</p>}

          {!loading && channels.length === 0 && (
            <div className="p-4 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-500">
              No hay canales de alerta registrados todavía. Agrega tu primer webhook o bot abajo.
            </div>
          )}

          <div className="space-y-2">
            {channels.map((ch) => {
              const isSlack = ch.type === 'SLACK';
              const isDiscord = ch.type === 'DISCORD';
              const badgeColor = isSlack
                ? 'bg-[#4A154B]/30 border-[#4A154B] text-purple-300'
                : isDiscord
                ? 'bg-[#5865F2]/20 border-[#5865F2] text-indigo-300'
                : 'bg-cyan-950 border-cyan-800 text-cyan-300';

              return (
                <div
                  key={ch.id}
                  className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badgeColor}`}>
                        {ch.type}
                      </span>
                      <span className="font-bold text-white">{ch.name}</span>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                          ch.isEnabled ? 'text-emerald-400 bg-emerald-950/40' : 'text-slate-500 bg-slate-800'
                        }`}
                      >
                        {ch.isEnabled ? 'Activo' : 'Pausado'}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 truncate max-w-md">
                      {ch.config.webhookUrl}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTest(ch.id)}
                      disabled={testingId === ch.id}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 text-[11px] transition"
                      title="Enviar alerta simulada de prueba"
                    >
                      <Send className="w-3 h-3 text-cyan-400" />
                      <span>{testingId === ch.id ? 'Probando...' : 'Probar'}</span>
                    </button>

                    <button
                      onClick={() => handleToggle(ch.id, ch.isEnabled)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition"
                    >
                      {ch.isEnabled ? 'Pausar' : 'Activar'}
                    </button>

                    <button
                      onClick={() => handleDelete(ch.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/30 transition"
                      title="Eliminar canal"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 animate-in fade-in duration-150 ${
                testResult.success
                  ? 'bg-emerald-950/20 border-emerald-800 text-emerald-300'
                  : 'bg-red-950/20 border-red-800 text-red-300'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>

        {/* Add Channel Form */}
        <form onSubmit={handleCreate} className="space-y-4 pt-4 border-t border-slate-800 text-xs">
          <h4 className="font-bold text-white flex items-center gap-1.5">
            <Plus className="w-4 h-4 text-cyan-400" /> Registrar Nuevo Canal
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Nombre Descriptivo</label>
              <input
                type="text"
                required
                placeholder="e.g. Slack Canal Infraestructura"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Tipo de Canal</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as 'WEBHOOK' | 'SLACK' | 'DISCORD')}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-cyan-500"
              >
                <option value="SLACK">Slack Incoming Webhook</option>
                <option value="DISCORD">Discord Webhook</option>
                <option value="WEBHOOK">Webhook JSON Genérico (con HMAC)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Webhook URL Objetivo</label>
            <input
              type="url"
              required
              placeholder="https://hooks.slack.com/services/... o https://discord.com/api/webhooks/..."
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-cyan-500"
            />
          </div>

          {newType === 'WEBHOOK' && (
            <div>
              <label className="block text-slate-400 mb-1">Clave Secreta HMAC (Opcional)</label>
              <input
                type="text"
                placeholder="Clave para generar X-PulseTrack-Signature (sha256)"
                value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-cyan-500"
              />
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold transition shadow-md disabled:opacity-50"
            >
              {isSubmitting ? 'Guardando...' : 'Guardar y Vincular Canal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
