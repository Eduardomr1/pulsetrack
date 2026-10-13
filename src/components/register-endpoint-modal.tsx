'use client';

import React, { useEffect, useRef, useState, useTransition } from 'react';
import {
  Plus,
  X,
  Globe,
  Clock,
  Zap,
  Tag,
  ShieldCheck,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import {
  AllowedHttpMethod,
  HTTP_METHODS,
  INTERVAL_PRESETS,
  validateRegisterEndpointForm,
  RegisterEndpointFormData,
} from '@/presentation/view-models/register-endpoint-validation';

export interface RegisterEndpointModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const COMMON_TAGS = ['production', 'api', 'gateway', 'auth', 'database', 'critical'];

export function RegisterEndpointModal({
  isOpen,
  onClose,
  onSuccess,
}: RegisterEndpointModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState<AllowedHttpMethod>('GET');
  const [intervalSeconds, setIntervalSeconds] = useState<number>(30);
  const [isCustomInterval, setIsCustomInterval] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState<number>(5000);
  const [slaLatencyMs, setSlaLatencyMs] = useState<number>(500);
  const [selectedTags, setSelectedTags] = useState<string[]>(['production']);
  const [customTagInput, setCustomTagInput] = useState('');

  const [errors, setErrors] = useState<Partial<Record<keyof RegisterEndpointFormData, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Gestión de accesibilidad: Autoenfoque al abrir y listener para tecla Escape
  useEffect(() => {
    if (isOpen) {
      setErrors({});
      setApiError(null);
      const timer = setTimeout(() => {
        nameInputRef.current?.focus();
      }, 50);

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && !isPending) {
          onClose();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
    return undefined;
  }, [isOpen, onClose, isPending]);

  if (!isOpen) return null;

  const handleToggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleAddCustomTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && customTagInput.trim()) {
      e.preventDefault();
      const clean = customTagInput.trim().toLowerCase();
      if (!selectedTags.includes(clean)) {
        setSelectedTags((prev) => [...prev, clean]);
      }
      setCustomTagInput('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    const formData: RegisterEndpointFormData = {
      name,
      url,
      method,
      intervalSeconds: Number(intervalSeconds),
      timeoutMs: Number(timeoutMs),
      slaLatencyMs: Number(slaLatencyMs),
      expectedStatusCodes: [200, 201, 204],
      tags: selectedTags,
    };

    const validation = validateRegisterEndpointForm(formData);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});

    startTransition(async () => {
      try {
        const payload = {
          name: formData.name,
          url: formData.url,
          method: formData.method,
          intervalSeconds: formData.intervalSeconds,
          timeoutMs: formData.timeoutMs,
          expectedStatusCodes: formData.expectedStatusCodes,
          assertions: [
            {
              target: 'latency_ms',
              operator: 'less_than',
              expectedValue: formData.slaLatencyMs,
            },
          ],
          tags: formData.tags,
        };

        const res = await fetch('/api/endpoints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error ?? 'Error en el servidor al registrar el endpoint');
        }

        // Limpieza y éxito
        setName('');
        setUrl('');
        setMethod('GET');
        setIntervalSeconds(30);
        setIsCustomInterval(false);
        setSlaLatencyMs(500);
        setSelectedTags(['production']);
        onSuccess();
        onClose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error inesperado';
        setApiError(msg);
      }
    });
  };

  const estimatedPingsPerDay = Math.round((86400 / (intervalSeconds || 30)));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="register-endpoint-title"
        aria-describedby="register-endpoint-desc"
        className="w-full max-w-xl rounded-2xl bg-[#0c1222] border border-slate-800 shadow-2xl p-6 sm:p-7 space-y-6 text-slate-100 my-8 max-h-[90vh] overflow-y-auto"
      >
        {/* Header Accesible */}
        <div className="flex items-start justify-between border-b border-slate-800/80 pb-4">
          <div className="space-y-1">
            <h2
              id="register-endpoint-title"
              className="text-lg font-bold text-white flex items-center gap-2.5"
            >
              <span className="p-1.5 rounded-lg bg-cyan-950/60 border border-cyan-800/50 text-cyan-400">
                <Plus className="w-4 h-4" />
              </span>
              <span>Registrar Nuevo Endpoint de Monitoreo</span>
            </h2>
            <p id="register-endpoint-desc" className="text-xs text-slate-400">
              Configura los parámetros de telemetría de socket, frecuencia de sondeo y SLA.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Cerrar modal de registro"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Banner de error si la API falla */}
        {apiError && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-red-950/40 border border-red-800/60 text-xs text-red-300 flex items-start gap-2.5"
          >
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Error al registrar:</span> {apiError}
            </div>
          </div>
        )}

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="space-y-5 text-xs">
          {/* Nombre */}
          <div className="space-y-1.5">
            <label htmlFor="ep-name" className="block font-semibold text-slate-200">
              Nombre del Servicio o API <span className="text-cyan-400">*</span>
            </label>
            <input
              ref={nameInputRef}
              id="ep-name"
              type="text"
              required
              placeholder="e.g. Auth Gateway & Session API"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
              }}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'ep-name-error' : undefined}
              className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border text-slate-100 placeholder-slate-500 text-xs transition focus:outline-none focus:ring-2 focus:ring-cyan-500/50 ${
                errors.name ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-700/80'
              }`}
            />
            {errors.name && (
              <p id="ep-name-error" role="alert" className="text-[11px] text-red-400 font-medium">
                {errors.name}
              </p>
            )}
          </div>

          {/* URL Objetivo */}
          <div className="space-y-1.5">
            <label htmlFor="ep-url" className="block font-semibold text-slate-200">
              URL Objetivo (HTTP o HTTPS) <span className="text-cyan-400">*</span>
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                <Globe className="w-4 h-4" />
              </span>
              <input
                id="ep-url"
                type="url"
                required
                placeholder="https://api.empresa.com/v1/health"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (errors.url) setErrors((prev) => ({ ...prev, url: undefined }));
                }}
                aria-invalid={!!errors.url}
                aria-describedby={errors.url ? 'ep-url-error' : undefined}
                className={`w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-900/90 border text-slate-100 placeholder-slate-500 font-mono text-xs transition focus:outline-none focus:ring-2 focus:ring-cyan-500/50 ${
                  errors.url ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-700/80'
                }`}
              />
            </div>
            {errors.url && (
              <p id="ep-url-error" role="alert" className="text-[11px] text-red-400 font-medium">
                {errors.url}
              </p>
            )}
          </div>

          {/* Selector Interactivo de Método HTTP */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-200">
              Método HTTP <span className="text-cyan-400">*</span>
            </label>
            <div
              role="radiogroup"
              aria-label="Selector de método HTTP"
              className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 p-1 rounded-xl bg-slate-900/60 border border-slate-800"
            >
              {HTTP_METHODS.map((m) => {
                const isSelected = method === m;
                let activeColor = 'bg-cyan-600 text-white font-bold shadow-md';
                if (m === 'POST') activeColor = 'bg-blue-600 text-white font-bold shadow-md';
                else if (m === 'PUT' || m === 'PATCH') activeColor = 'bg-amber-600 text-white font-bold shadow-md';
                else if (m === 'DELETE') activeColor = 'bg-red-600 text-white font-bold shadow-md';

                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setMethod(m)}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-mono text-center transition ${
                      isSelected
                        ? activeColor
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selector Interactivo de Intervalo de Sondeo */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>Intervalo de Sondeo</span>
              </label>
              <span className="text-[11px] font-mono text-slate-400">
                {estimatedPingsPerDay.toLocaleString()} pings / día
              </span>
            </div>

            {/* Presets de Intervalo */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {INTERVAL_PRESETS.map((preset) => {
                const isSelected = !isCustomInterval && intervalSeconds === preset.seconds;
                return (
                  <button
                    key={preset.seconds}
                    type="button"
                    onClick={() => {
                      setIntervalSeconds(preset.seconds);
                      setIsCustomInterval(false);
                      if (errors.intervalSeconds) {
                        setErrors((prev) => ({ ...prev, intervalSeconds: undefined }));
                      }
                    }}
                    className={`p-2 rounded-xl border text-center transition flex flex-col items-center justify-center ${
                      isSelected
                        ? 'border-cyan-500 bg-cyan-950/40 text-cyan-300 font-bold shadow-sm shadow-cyan-950'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <span className="font-mono text-xs font-bold">{preset.label}</span>
                    <span className="text-[9px] text-slate-500 truncate w-full">{preset.note}</span>
                  </button>
                );
              })}
            </div>

            {/* Alternativa Custom */}
            <div className="flex items-center gap-2 pt-1">
              <label className="text-[11px] text-slate-400 flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isCustomInterval}
                  onChange={(e) => setIsCustomInterval(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
                />
                <span>Personalizar intervalo en segundos</span>
              </label>

              {isCustomInterval && (
                <div className="flex-1 max-w-[140px]">
                  <input
                    type="number"
                    min={5}
                    max={86400}
                    value={intervalSeconds}
                    onChange={(e) => {
                      setIntervalSeconds(Number(e.target.value));
                      if (errors.intervalSeconds) {
                        setErrors((prev) => ({ ...prev, intervalSeconds: undefined }));
                      }
                    }}
                    className="w-full px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white text-center focus:outline-none focus:border-cyan-500"
                  />
                </div>
              )}
            </div>
            {errors.intervalSeconds && (
              <p role="alert" className="text-[11px] text-red-400 font-medium">
                {errors.intervalSeconds}
              </p>
            )}
          </div>

          {/* Configuración de Rendimiento & SLA */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3.5 rounded-xl bg-slate-900/40 border border-slate-800/80">
            {/* SLA Latencia */}
            <div className="space-y-1.5">
              <label htmlFor="sla-latency" className="block font-semibold text-slate-200 flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>SLA Latencia Máx.</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="sla-latency"
                  type="number"
                  min={20}
                  step={50}
                  value={slaLatencyMs}
                  onChange={(e) => setSlaLatencyMs(Number(e.target.value))}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-500"
                />
                <span className="text-slate-500 font-mono">ms</span>
              </div>
              <p className="text-[10px] text-slate-500">
                Superar este umbral marcará el estado como <strong>DEGRADED</strong>.
              </p>
            </div>

            {/* Timeout */}
            <div className="space-y-1.5">
              <label htmlFor="timeout-ms" className="block font-semibold text-slate-200 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-purple-400" />
                <span>Timeout de Socket</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="timeout-ms"
                  type="number"
                  min={500}
                  step={500}
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(Number(e.target.value))}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-purple-300 focus:outline-none focus:border-purple-500"
                />
                <span className="text-slate-500 font-mono">ms</span>
              </div>
              <p className="text-[10px] text-slate-500">
                Límite máximo para abortar si no hay respuesta de socket.
              </p>
            </div>
          </div>

          {/* Etiquetas / Tags */}
          <div className="space-y-2">
            <label className="font-semibold text-slate-200 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-cyan-400" />
              <span>Etiquetas de Servicio</span>
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {COMMON_TAGS.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleToggleTag(tag)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-mono border transition ${
                      isSelected
                        ? 'border-cyan-500/60 bg-cyan-950/40 text-cyan-300'
                        : 'border-slate-800 bg-slate-900/60 text-slate-500 hover:text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    #{tag}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              placeholder="Escribe una etiqueta y presiona Enter..."
              value={customTagInput}
              onChange={(e) => setCustomTagInput(e.target.value)}
              onKeyDown={handleAddCustomTag}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Footer de Acciones */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800/80">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="px-4 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 font-medium transition focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={isPending}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-extrabold flex items-center gap-2 shadow-lg shadow-cyan-500/20 transition focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-60"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                  <span>Registrando...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-slate-950" />
                  <span>Guardar & Iniciar Sondeo</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
