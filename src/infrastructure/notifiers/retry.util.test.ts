import { describe, it, expect, vi } from 'vitest';
import {
  calculateBackoffDelay,
  isTransientError,
  executeHttpDeliveryWithRetry,
} from './retry.util';

describe('Retry & Exponential Backoff Utilities (PulseTrack Notifiers)', () => {
  describe('calculateBackoffDelay()', () => {
    it('calcula delays exponenciales correctos sin jitter', () => {
      expect(calculateBackoffDelay(1, 100, 2, 5000, false)).toBe(100);
      expect(calculateBackoffDelay(2, 100, 2, 5000, false)).toBe(200);
      expect(calculateBackoffDelay(3, 100, 2, 5000, false)).toBe(400);
      expect(calculateBackoffDelay(4, 100, 2, 5000, false)).toBe(800);
    });

    it('respeta el límite superior maxDelayMs', () => {
      const delay = calculateBackoffDelay(10, 100, 2, 1000, false);
      expect(delay).toBe(1000);
    });

    it('añade componente aleatorio acotado cuando jitter es true', () => {
      const delay = calculateBackoffDelay(2, 200, 2, 5000, true);
      expect(delay).toBeGreaterThanOrEqual(400);
      expect(delay).toBeLessThanOrEqual(500); // 400 + min(100, 400 * 0.3)
    });
  });

  describe('isTransientError()', () => {
    it('identifica 429 Too Many Requests como transitorio', () => {
      expect(isTransientError(null, 429)).toBe(true);
    });

    it('identifica errores 5xx como transitorios', () => {
      expect(isTransientError(null, 500)).toBe(true);
      expect(isTransientError(null, 502)).toBe(true);
      expect(isTransientError(null, 503)).toBe(true);
      expect(isTransientError(null, 504)).toBe(true);
    });

    it('identifica errores 4xx (excepto 429) como permanentes (no transitorios)', () => {
      expect(isTransientError(null, 400)).toBe(false);
      expect(isTransientError(null, 401)).toBe(false);
      expect(isTransientError(null, 403)).toBe(false);
      expect(isTransientError(null, 404)).toBe(false);
    });

    it('trata fallos de red / excepciones sin código como transitorios', () => {
      expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
    });
  });

  describe('executeHttpDeliveryWithRetry()', () => {
    it('retorna éxito inmediato en el intento 1 si la respuesta es 200 OK', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      global.fetch = mockFetch;

      const result = await executeHttpDeliveryWithRetry(
        'https://hooks.slack.com/services/test',
        { method: 'POST', body: '{"text":"test"}' },
        { maxRetries: 3 }
      );

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.attempts).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('se rinde inmediatamente en el primer intento si recibe 400 Bad Request (error no transitorio)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });
      global.fetch = mockFetch;

      const result = await executeHttpDeliveryWithRetry(
        'https://discord.com/api/webhooks/test',
        { method: 'POST', body: '{}' },
        { maxRetries: 3 }
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.attempts).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('reintenta y se recupera en el segundo intento tras un 503 Service Unavailable', async () => {
      const sleepFn = vi.fn().mockResolvedValue(undefined);
      const onRetry = vi.fn();

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        });
      global.fetch = mockFetch;

      const result = await executeHttpDeliveryWithRetry(
        'https://webhook.site/test',
        { method: 'POST', body: '{"status":"DOWN"}' },
        {
          maxRetries: 3,
          initialDelayMs: 50,
          sleepFn,
          onRetry,
        }
      );

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.attempts).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(sleepFn).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Number), 'HTTP 503 Service Unavailable', 503);
    });

    it('agota los reintentos y reporta fallo si el servidor devuelve continuamente 500', async () => {
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });
      global.fetch = mockFetch;

      const result = await executeHttpDeliveryWithRetry(
        'https://webhook.site/test',
        { method: 'POST' },
        {
          maxRetries: 3,
          initialDelayMs: 10,
          sleepFn,
        }
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.attempts).toBe(3);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(sleepFn).toHaveBeenCalledTimes(2);
    });
  });
});
