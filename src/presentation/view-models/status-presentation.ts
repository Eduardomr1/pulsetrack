export type NormalizedHealthStatus = 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';

export interface StatusVisualConfig {
  status: NormalizedHealthStatus;
  rawStatus: string;
  label: string;
  shortLabel: string;
  badgeClass: string;
  pingClass: string;
  dotClass: string;
  textClass: string;
  borderClass: string;
  bgClass: string;
  glowClass: string;
  ariaDescription: string;
}

/**
 * Normaliza cualquier string de estado de servicio a los 4 estados canónicos:
 * OPERATIONAL (verde), DEGRADED (ámbar), DOWN (rojo), UNKNOWN (gris).
 */
export function normalizeHealthStatus(status: string | null | undefined): NormalizedHealthStatus {
  if (!status) return 'UNKNOWN';

  const s = status.trim().toUpperCase();
  switch (s) {
    case 'OPERATIONAL':
    case 'HEALTHY':
    case 'UP':
    case 'PASS':
    case 'OK':
      return 'OPERATIONAL';

    case 'DEGRADED':
    case 'WARN':
    case 'WARNING':
    case 'SLOW':
      return 'DEGRADED';

    case 'DOWN':
    case 'OUTAGE':
    case 'FAIL':
    case 'FAILED':
    case 'CRITICAL':
    case 'ERROR':
      return 'DOWN';

    default:
      return 'UNKNOWN';
  }
}

/**
 * Retorna la configuración visual, clases de Tailwind y metadatos accesibles
 * correspondientes a cada estado.
 */
export function getStatusVisualConfig(status: string | null | undefined): StatusVisualConfig {
  const normalized = normalizeHealthStatus(status);
  const raw = status ?? 'UNKNOWN';

  switch (normalized) {
    case 'OPERATIONAL':
      return {
        status: 'OPERATIONAL',
        rawStatus: raw,
        label: 'Operacional',
        shortLabel: 'OPERATIONAL',
        badgeClass: 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]',
        pingClass: 'bg-emerald-400',
        dotClass: 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]',
        textClass: 'text-emerald-400',
        borderClass: 'border-emerald-500/40',
        bgClass: 'bg-emerald-950/20',
        glowClass: 'shadow-[0_0_16px_rgba(16,185,129,0.25)]',
        ariaDescription: 'El servicio está completamente operacional y respondiendo dentro de los parámetros de SLA.',
      };

    case 'DEGRADED':
      return {
        status: 'DEGRADED',
        rawStatus: raw,
        label: 'Degradado',
        shortLabel: 'DEGRADED',
        badgeClass: 'border-amber-500/40 bg-amber-950/30 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.15)]',
        pingClass: 'bg-amber-400',
        dotClass: 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)]',
        textClass: 'text-amber-400',
        borderClass: 'border-amber-500/40',
        bgClass: 'bg-amber-950/20',
        glowClass: 'shadow-[0_0_16px_rgba(245,158,11,0.25)]',
        ariaDescription: 'El servicio experimenta degradación de rendimiento, alta latencia o aserciones fallidas.',
      };

    case 'DOWN':
      return {
        status: 'DOWN',
        rawStatus: raw,
        label: 'Interrupción / Caído',
        shortLabel: 'DOWN',
        badgeClass: 'border-red-500/40 bg-red-950/30 text-red-300 shadow-[0_0_12px_rgba(239,68,68,0.2)]',
        pingClass: 'bg-red-400',
        dotClass: 'bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.7)]',
        textClass: 'text-red-400',
        borderClass: 'border-red-500/40',
        bgClass: 'bg-red-950/20',
        glowClass: 'shadow-[0_0_16px_rgba(239,68,68,0.3)]',
        ariaDescription: 'Interrupción crítica: el servicio no responde, timed out o devuelve errores HTTP 5xx.',
      };

    case 'UNKNOWN':
    default:
      return {
        status: 'UNKNOWN',
        rawStatus: raw,
        label: 'Desconocido / Sin Datos',
        shortLabel: 'UNKNOWN',
        badgeClass: 'border-slate-700/60 bg-slate-900/50 text-slate-400',
        pingClass: 'bg-slate-500',
        dotClass: 'bg-slate-500',
        textClass: 'text-slate-400',
        borderClass: 'border-slate-800',
        bgClass: 'bg-slate-900/30',
        glowClass: '',
        ariaDescription: 'No hay datos de telemetría recientes para determinar el estado del servicio.',
      };
  }
}

/**
 * Formatea un valor de latencia en milisegundos con 1 decimal y su unidad 'ms'.
 */
export function formatLatencyMs(latencyMs: number | null | undefined): string {
  if (latencyMs === null || latencyMs === undefined || isNaN(latencyMs)) {
    return '— ms';
  }
  if (latencyMs === 0) return '0.0 ms';
  return `${latencyMs.toFixed(1)} ms`;
}

/**
 * Formatea porcentaje de uptime con 2 decimales y símbolo %.
 */
export function formatUptimePercent(percentage: number | null | undefined): string {
  if (percentage === null || percentage === undefined || isNaN(percentage)) {
    return '100.00%';
  }
  return `${percentage.toFixed(2)}%`;
}

/**
 * Determina si la latencia actual está dentro del SLA, en advertencia o crítica.
 */
export function evaluateLatencySla(
  latencyMs: number,
  slaThresholdMs = 500
): { status: 'OPTIMAL' | 'WARNING' | 'BREACHED'; ratio: number } {
  if (slaThresholdMs <= 0) {
    return { status: 'OPTIMAL', ratio: 0 };
  }
  const ratio = latencyMs / slaThresholdMs;
  if (ratio <= 0.75) return { status: 'OPTIMAL', ratio };
  if (ratio <= 1.0) return { status: 'WARNING', ratio };
  return { status: 'BREACHED', ratio };
}
