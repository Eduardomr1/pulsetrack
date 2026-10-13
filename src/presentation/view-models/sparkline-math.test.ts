import { describe, it, expect } from 'vitest';
import {
  normalizeSparklineData,
  calculateSparklineMetrics,
  calculateSparkline,
  formatSparklineTooltip,
} from './sparkline-math';

describe('sparkline-math (Geometría SVG & Métricas de Latencia Histórica)', () => {
  describe('normalizeSparklineData', () => {
    it('normaliza un array simple de números a objetos con value y label', () => {
      const result = normalizeSparklineData([10, 25, 50]);
      expect(result).toHaveLength(3);
      expect(result[0]!.value).toBe(10);
      expect(result[0]!.label).toBe('Muestra #1');
      expect(result[2]!.value).toBe(50);
    });

    it('respeta objetos preformateados con timestamps', () => {
      const ts = '2026-10-12T14:00:00.000Z';
      const result = normalizeSparklineData([
        { value: 42, timestamp: ts, label: 'Ping 1' },
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]!.value).toBe(42);
      expect(result[0]!.timestamp).toBe(ts);
      expect(result[0]!.label).toBe('Ping 1');
    });

    it('ignora números negativos y NaNs convirtiéndolos a 0', () => {
      const result = normalizeSparklineData([-5, NaN, 20]);
      expect(result[0]!.value).toBe(0);
      expect(result[1]!.value).toBe(0);
      expect(result[2]!.value).toBe(20);
    });
  });

  describe('calculateSparklineMetrics', () => {
    it('calcula min, max, avg, latest y tendencia correctamente', () => {
      const data = [{ value: 100 }, { value: 150 }, { value: 200 }];
      const metrics = calculateSparklineMetrics(data);

      expect(metrics.count).toBe(3);
      expect(metrics.min).toBe(100);
      expect(metrics.max).toBe(200);
      expect(metrics.avg).toBe(150);
      expect(metrics.latest).toBe(200);
      expect(metrics.trend).toBe('UP');
      expect(metrics.deltaPercent).toBe(100);
    });

    it('detecta tendencia descendente cuando la latencia mejora', () => {
      const data = [{ value: 200 }, { value: 100 }];
      const metrics = calculateSparklineMetrics(data);

      expect(metrics.trend).toBe('DOWN');
      expect(metrics.deltaPercent).toBe(-50);
    });

    it('detecta tendencia estable si el delta es menor al 5%', () => {
      const data = [{ value: 100 }, { value: 102 }];
      const metrics = calculateSparklineMetrics(data);

      expect(metrics.trend).toBe('STABLE');
    });

    it('maneja arrays vacíos sin lanzar excepciones', () => {
      const metrics = calculateSparklineMetrics([]);
      expect(metrics.count).toBe(0);
      expect(metrics.min).toBe(0);
      expect(metrics.trend).toBe('STABLE');
    });
  });

  describe('calculateSparkline', () => {
    it('genera coordenadas SVG válidas y paths de línea y área cerrada', () => {
      const raw = [30, 45, 60, 20, 80];
      const result = calculateSparkline(raw, {
        width: 300,
        height: 60,
      });

      expect(result.points).toHaveLength(5);
      expect(result.viewBox).toBe('0 0 300 60');

      // El path de línea debe comenzar con M
      expect(result.linePath).toMatch(/^M\s+\d+(\.\d+)?\s+\d+(\.\d+)?/);

      // El path de área debe cerrar con Z
      expect(result.areaPath).toMatch(/Z$/);

      // Los puntos X deben ser monótonamente crecientes
      for (let i = 1; i < result.points.length; i++) {
        expect(result.points[i]!.x).toBeGreaterThan(result.points[i - 1]!.x);
      }
    });

    it('maneja un único punto de latencia dibujando una línea horizontal', () => {
      const result = calculateSparkline([50], { width: 200, height: 50 });
      expect(result.points).toHaveLength(1);
      expect(result.linePath).toContain('M');
      expect(result.linePath).toContain('L');
      expect(result.areaPath).toMatch(/Z$/);
    });

    it('maneja un conjunto vacío devolviendo paths vacíos', () => {
      const result = calculateSparkline([]);
      expect(result.points).toHaveLength(0);
      expect(result.linePath).toBe('');
      expect(result.areaPath).toBe('');
    });
  });

  describe('formatSparklineTooltip', () => {
    it('formatea el tooltip con latencia en milisegundos y delta con promedio', () => {
      const point = {
        index: 2,
        value: 75.43,
        x: 100,
        y: 20,
        timestamp: '2026-10-12T10:30:00.000Z',
        label: 'Ping #3',
      };

      const tooltip = formatSparklineTooltip(point, 50.0);
      expect(tooltip.primary).toBe('75.4 ms');
      expect(tooltip.deltaText).toBe('+25.4 ms vs prom');
      expect(tooltip.secondary).toBeDefined();
    });
  });
});
