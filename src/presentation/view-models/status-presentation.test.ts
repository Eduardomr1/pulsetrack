import { describe, it, expect } from 'vitest';
import {
  normalizeHealthStatus,
  getStatusVisualConfig,
  formatLatencyMs,
  formatUptimePercent,
  evaluateLatencySla,
} from './status-presentation';

describe('status-presentation (Lógica de Presentación de Estados)', () => {
  describe('normalizeHealthStatus', () => {
    it('debe mapear variantes operacionales a OPERATIONAL (verde)', () => {
      expect(normalizeHealthStatus('OPERATIONAL')).toBe('OPERATIONAL');
      expect(normalizeHealthStatus('HEALTHY')).toBe('OPERATIONAL');
      expect(normalizeHealthStatus('UP')).toBe('OPERATIONAL');
      expect(normalizeHealthStatus('PASS')).toBe('OPERATIONAL');
      expect(normalizeHealthStatus('OK')).toBe('OPERATIONAL');
      expect(normalizeHealthStatus('operational')).toBe('OPERATIONAL');
    });

    it('debe mapear variantes degradadas a DEGRADED (ámbar)', () => {
      expect(normalizeHealthStatus('DEGRADED')).toBe('DEGRADED');
      expect(normalizeHealthStatus('WARN')).toBe('DEGRADED');
      expect(normalizeHealthStatus('WARNING')).toBe('DEGRADED');
      expect(normalizeHealthStatus('SLOW')).toBe('DEGRADED');
    });

    it('debe mapear variantes caídas a DOWN (rojo)', () => {
      expect(normalizeHealthStatus('DOWN')).toBe('DOWN');
      expect(normalizeHealthStatus('OUTAGE')).toBe('DOWN');
      expect(normalizeHealthStatus('FAIL')).toBe('DOWN');
      expect(normalizeHealthStatus('FAILED')).toBe('DOWN');
      expect(normalizeHealthStatus('CRITICAL')).toBe('DOWN');
      expect(normalizeHealthStatus('ERROR')).toBe('DOWN');
    });

    it('debe mapear valores nulos o desconocidos a UNKNOWN', () => {
      expect(normalizeHealthStatus(null)).toBe('UNKNOWN');
      expect(normalizeHealthStatus(undefined)).toBe('UNKNOWN');
      expect(normalizeHealthStatus('')).toBe('UNKNOWN');
      expect(normalizeHealthStatus('RANDOM_STATUS')).toBe('UNKNOWN');
    });
  });

  describe('getStatusVisualConfig', () => {
    it('debe retornar configuración verde esmeralda con animación para OPERATIONAL', () => {
      const config = getStatusVisualConfig('HEALTHY');
      expect(config.status).toBe('OPERATIONAL');
      expect(config.label).toBe('Operacional');
      expect(config.badgeClass).toContain('emerald');
      expect(config.pingClass).toContain('bg-emerald-400');
      expect(config.dotClass).toContain('bg-emerald-400');
      expect(config.ariaDescription).toContain('operacional');
    });

    it('debe retornar configuración ámbar con animación para DEGRADED', () => {
      const config = getStatusVisualConfig('DEGRADED');
      expect(config.status).toBe('DEGRADED');
      expect(config.label).toBe('Degradado');
      expect(config.badgeClass).toContain('amber');
      expect(config.pingClass).toContain('bg-amber-400');
      expect(config.dotClass).toContain('bg-amber-400');
      expect(config.ariaDescription).toContain('degradación');
    });

    it('debe retornar configuración roja con animación para DOWN', () => {
      const config = getStatusVisualConfig('DOWN');
      expect(config.status).toBe('DOWN');
      expect(config.label).toBe('Interrupción / Caído');
      expect(config.badgeClass).toContain('red');
      expect(config.pingClass).toContain('bg-red-400');
      expect(config.dotClass).toContain('bg-red-400');
      expect(config.ariaDescription).toContain('Interrupción crítica');
    });

    it('debe retornar configuración neutral para UNKNOWN', () => {
      const config = getStatusVisualConfig(null);
      expect(config.status).toBe('UNKNOWN');
      expect(config.badgeClass).toContain('slate');
      expect(config.pingClass).toContain('slate');
    });
  });

  describe('formatLatencyMs', () => {
    it('formatea números con un decimal y unidad ms', () => {
      expect(formatLatencyMs(45.26)).toBe('45.3 ms');
      expect(formatLatencyMs(120)).toBe('120.0 ms');
      expect(formatLatencyMs(0)).toBe('0.0 ms');
    });

    it('maneja valores indefinidos o nulos devolviendo un placeholder seguro', () => {
      expect(formatLatencyMs(null)).toBe('— ms');
      expect(formatLatencyMs(undefined)).toBe('— ms');
      expect(formatLatencyMs(NaN)).toBe('— ms');
    });
  });

  describe('formatUptimePercent', () => {
    it('formatea porcentajes a 2 decimales con símbolo %', () => {
      expect(formatUptimePercent(99.954)).toBe('99.95%');
      expect(formatUptimePercent(100)).toBe('100.00%');
      expect(formatUptimePercent(0)).toBe('0.00%');
    });

    it('maneja valores nulos devolviendo 100.00% por defecto', () => {
      expect(formatUptimePercent(null)).toBe('100.00%');
      expect(formatUptimePercent(undefined)).toBe('100.00%');
    });
  });

  describe('evaluateLatencySla', () => {
    it('retorna OPTIMAL cuando la latencia está por debajo del 75% del SLA', () => {
      const res = evaluateLatencySla(200, 500);
      expect(res.status).toBe('OPTIMAL');
      expect(res.ratio).toBe(0.4);
    });

    it('retorna WARNING cuando la latencia está entre el 75% y 100% del SLA', () => {
      const res = evaluateLatencySla(450, 500);
      expect(res.status).toBe('WARNING');
      expect(res.ratio).toBe(0.9);
    });

    it('retorna BREACHED cuando la latencia supera el SLA', () => {
      const res = evaluateLatencySla(650, 500);
      expect(res.status).toBe('BREACHED');
      expect(res.ratio).toBe(1.3);
    });
  });
});
