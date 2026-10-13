/**
 * PulseTrack Observability Suite
 * Exponential Backoff with Jitter & Retry Delivery Utility
 * 
 * Implements exponential backoff with full jitter to avoid thundering herd problems,
 * selective retry on transient failures (429 Rate Limited, 5xx Server Errors, Network drops),
 * and early exit on permanent client errors (400 Bad Request, 401, 403, 404).
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  timeoutMs?: number;
  isRetryable?: (error: unknown, statusCode?: number) => boolean;
  onRetry?: (attempt: number, delayMs: number, error: unknown, statusCode?: number) => void;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  errorMessage?: string;
  attempts: number;
}

export type WebhookDeliveryResult = DeliveryResult;
export type DiscordDeliveryResult = DeliveryResult;
export type SlackDeliveryResult = DeliveryResult;

/**
 * Determines whether a given HTTP status code or runtime error is transient (and therefore retryable).
 */
export function isTransientError(_error: unknown, statusCode?: number): boolean {
  if (statusCode !== undefined) {
    // 429 Too Many Requests is transient
    if (statusCode === 429) return true;
    // 5xx Server Errors (500 Internal, 502 Bad Gateway, 503 Unavailable, 504 Gateway Timeout)
    if (statusCode >= 500 && statusCode < 600) return true;
    // 4xx Client Errors are permanent (misconfiguration, invalid schema, unauthorized)
    if (statusCode >= 400 && statusCode < 500) return false;
  }

  // Network drops, ECONNREFUSED, fetch TypeError, abort timeouts
  return true;
}

/**
 * Computes exponential delay with optional randomized jitter:
 * delay = min(initialDelay * (backoffFactor ^ (attempt - 1)), maxDelay) + jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  initialDelayMs: number = 200,
  backoffFactor: number = 2,
  maxDelayMs: number = 5000,
  jitter: boolean = true
): number {
  const base = initialDelayMs * Math.pow(backoffFactor, Math.max(0, attempt - 1));
  const capped = Math.min(base, maxDelayMs);
  if (!jitter) return Math.round(capped);

  // Proportional jitter (between 0% and 30% of capped delay or up to 100ms)
  const jitterOffset = Math.random() * Math.min(100, capped * 0.3);
  return Math.round(capped + jitterOffset);
}

/**
 * Executes an HTTP fetch request with exponential backoff retries.
 */
export async function executeHttpDeliveryWithRetry(
  url: string,
  requestInit: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
  options?: RetryOptions
): Promise<DeliveryResult> {
  const maxRetries = options?.maxRetries ?? 3;
  const initialDelayMs = options?.initialDelayMs ?? 200;
  const backoffFactor = options?.backoffFactor ?? 2;
  const maxDelayMs = options?.maxDelayMs ?? 5000;
  const jitter = options?.jitter ?? true;
  const timeoutMs = options?.timeoutMs ?? 6000;
  const sleep = options?.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const isRetryable = options?.isRetryable ?? isTransientError;

  let lastStatusCode: number | undefined;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: requestInit.method ?? 'POST',
        headers: requestInit.headers,
        body: requestInit.body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      lastStatusCode = response.status;

      if (response.ok) {
        return {
          success: true,
          statusCode: response.status,
          attempts: attempt,
        };
      }

      lastError = `HTTP ${response.status} ${response.statusText}`.trim();

      // If client error (e.g. 400 Bad Request, 401 Unauthorized), do not retry
      if (!isRetryable(undefined, response.status)) {
        return {
          success: false,
          statusCode: response.status,
          errorMessage: lastError,
          attempts: attempt,
        };
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      lastError = isAbort
        ? `Timeout de entrega agotado (${timeoutMs}ms)`
        : err instanceof Error
        ? err.message
        : 'Error desconocido de red al entregar notificación';

      if (!isRetryable(err, undefined)) {
        return {
          success: false,
          statusCode: lastStatusCode,
          errorMessage: lastError,
          attempts: attempt,
        };
      }
    }

    // Exponential delay before next attempt
    if (attempt < maxRetries) {
      const delay = calculateBackoffDelay(attempt, initialDelayMs, backoffFactor, maxDelayMs, jitter);
      options?.onRetry?.(attempt, delay, lastError, lastStatusCode);
      await sleep(delay);
    }
  }

  return {
    success: false,
    statusCode: lastStatusCode,
    errorMessage: lastError,
    attempts: maxRetries,
  };
}
