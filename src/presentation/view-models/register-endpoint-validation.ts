export type AllowedHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface RegisterEndpointFormData {
  name: string;
  url: string;
  method: AllowedHttpMethod;
  intervalSeconds: number;
  timeoutMs: number;
  slaLatencyMs: number;
  expectedStatusCodes?: number[];
  tags?: string[];
}

export interface FormValidationResult {
  isValid: boolean;
  errors: Partial<Record<keyof RegisterEndpointFormData, string>>;
}

export const HTTP_METHODS: AllowedHttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

export const INTERVAL_PRESETS: Array<{ label: string; seconds: number; note: string }> = [
  { label: '10s', seconds: 10, note: 'Crítico / Alta Frecuencia' },
  { label: '30s', seconds: 30, note: 'Recomendado' },
  { label: '60s', seconds: 60, note: 'Estándar (1 min)' },
  { label: '5m', seconds: 300, note: 'Económico (5 min)' },
  { label: '15m', seconds: 900, note: 'Bajo Impacto (15 min)' },
];

export const SLA_PRESETS: Array<{ label: string; ms: number }> = [
  { label: '150 ms (Ultra)', ms: 150 },
  { label: '300 ms (Rápido)', ms: 300 },
  { label: '500 ms (SLA Estándar)', ms: 500 },
  { label: '1,000 ms (1s)', ms: 1000 },
  { label: '2,500 ms (2.5s)', ms: 2500 },
];

/**
 * Valida un string de URL para asegurar que sea sintácticamente válido
 * y use esquema http o https.
 */
export function isValidHttpUrl(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const trimmed = urlStr.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Valida los datos del formulario de registro de nuevo endpoint.
 */
export function validateRegisterEndpointForm(data: Partial<RegisterEndpointFormData>): FormValidationResult {
  const errors: Partial<Record<keyof RegisterEndpointFormData, string>> = {};

  // Validar nombre
  const name = data.name?.trim();
  if (!name) {
    errors.name = 'El nombre del servicio es obligatorio.';
  } else if (name.length < 2) {
    errors.name = 'El nombre debe tener al menos 2 caracteres.';
  } else if (name.length > 80) {
    errors.name = 'El nombre no puede superar los 80 caracteres.';
  }

  // Validar URL
  const url = data.url?.trim();
  if (!url) {
    errors.url = 'La URL objetivo es obligatoria.';
  } else if (!isValidHttpUrl(url)) {
    errors.url = 'Ingresa una URL válida que comience con http:// o https://';
  }

  // Validar Método
  if (!data.method) {
    errors.method = 'Selecciona un método HTTP.';
  } else if (!HTTP_METHODS.includes(data.method)) {
    errors.method = `Método HTTP no soportado: ${data.method}`;
  }

  // Validar Intervalo
  const interval = data.intervalSeconds;
  if (interval === undefined || interval === null || isNaN(interval)) {
    errors.intervalSeconds = 'El intervalo de sondeo es obligatorio.';
  } else if (!Number.isInteger(interval) || interval < 5) {
    errors.intervalSeconds = 'El intervalo mínimo de sondeo es de 5 segundos.';
  } else if (interval > 86400) {
    errors.intervalSeconds = 'El intervalo máximo es de 86,400 segundos (24 horas).';
  }

  // Validar Timeout
  const timeout = data.timeoutMs;
  if (timeout !== undefined && timeout !== null) {
    if (isNaN(timeout) || timeout < 500) {
      errors.timeoutMs = 'El timeout mínimo es de 500 ms.';
    } else if (timeout > 60000) {
      errors.timeoutMs = 'El timeout máximo es de 60,000 ms (60s).';
    }
  }

  // Validar SLA Latencia
  const sla = data.slaLatencyMs;
  if (sla !== undefined && sla !== null) {
    if (isNaN(sla) || sla < 20) {
      errors.slaLatencyMs = 'El SLA de latencia mínima es de 20 ms.';
    } else if (sla > 60000) {
      errors.slaLatencyMs = 'El SLA de latencia máxima no puede superar 60,000 ms.';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}
