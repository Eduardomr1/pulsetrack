import { describe, it, expect } from 'vitest';
import { ApdexThresholdVo } from '../value-objects/apdex-threshold.vo';
import {
  LatencyAnalyticsService,
  LatencyTelemetrySample,
} from './latency-analytics.service';

describe('ApdexThresholdVo & LatencyAnalyticsService', () => {
  const analytics = new LatencyAnalyticsService();
  const baseTime = new Date('2026-10-20T16:00:00.000Z');

  describe('ApdexThresholdVo', () => {
    it('configura por defecto la banda de tolerancia en 4T y valida invariantes', () => {
      const vo = ApdexThresholdVo.standardWebApi(200);
      expect(vo.satisfiedThresholdMs).toBe(200);
      expect(vo.toleratingThresholdMs).toBe(800);

      expect(() => new ApdexThresholdVo(0)).toThrow();
      expect(() => new ApdexThresholdVo(250, 200)).toThrow();
    });

    it('clasifica peticiones fallidas siempre como FRUSTRATED sin importar baja latencia', () => {
      const vo = new ApdexThresholdVo(250, 1000);
      expect(vo.classifySample(80, false)).toBe('SATISFIED');
      expect(vo.classifySample(250, false)).toBe('SATISFIED');
      expect(vo.classifySample(600, false)).toBe('TOLERATING');
      expect(vo.classifySample(1200, false)).toBe('FRUSTRATED');
      expect(vo.classifySample(4, true)).toBe('FRUSTRATED');
    });

    it('calcula score Apdex exacto y asigna bandas de calificación estándar', () => {
      const vo = new ApdexThresholdVo(200, 800);

      // (92 + 0.5 * 6) / 100 = 0.950 -> EXCELLENT
      const excellent = vo.computeScore({ satisfied: 92, tolerating: 6, frustrated: 2 });
      expect(excellent.score).toBe(0.95);
      expect(excellent.rating).toBe('EXCELLENT');

      // (80 + 0.5 * 16) / 100 = 0.880 -> GOOD
      expect(vo.computeScore({ satisfied: 80, tolerating: 16, frustrated: 4 }).rating).toBe(
        'GOOD'
      );

      // (60 + 0.5 * 30) / 100 = 0.750 -> FAIR
      expect(vo.computeScore({ satisfied: 60, tolerating: 30, frustrated: 10 }).rating).toBe(
        'FAIR'
      );

      // (50 + 0.5 * 10) / 100 = 0.550 -> POOR
      expect(vo.computeScore({ satisfied: 50, tolerating: 10, frustrated: 40 }).rating).toBe(
        'POOR'
      );

      // (20 + 0.5 * 20) / 100 = 0.300 -> UNACCEPTABLE
      expect(vo.computeScore({ satisfied: 20, tolerating: 20, frustrated: 60 }).rating).toBe(
        'UNACCEPTABLE'
      );

      expect(vo.computeScore({ satisfied: 0, tolerating: 0, frustrated: 0 }).rating).toBe(
        'NO_DATA'
      );
    });
  });

  describe('LatencyAnalyticsService - Percentiles & Jitter', () => {
    it('retorna estructura segura en cero cuando no existen muestras', () => {
      const report = analytics.analyze([]);
      expect(report.distribution.sampleCount).toBe(0);
      expect(report.distribution.p95Ms).toBe(0);
      expect(report.apdex.rating).toBe('NO_DATA');
      expect(report.bottleneck.dominantPhase).toBeNull();
      expect(report.anomalies).toHaveLength(0);
    });

    it('interpola linealmente percentiles continuos (p50, p90, p95, p99) y amplificación de cola', () => {
      // 11 valores equiespaciados de 10ms a 110ms -> p50 = 60, p90 = 100, p95 = 105, p99 = 109
      const samples: LatencyTelemetrySample[] = Array.from({ length: 11 }, (_, idx) => ({
        timestamp: new Date(baseTime.getTime() + idx * 10_000),
        totalMs: (idx + 1) * 10,
      }));

      const report = analytics.analyze(samples);
      expect(report.distribution.minMs).toBe(10);
      expect(report.distribution.maxMs).toBe(110);
      expect(report.distribution.meanMs).toBe(60);
      expect(report.distribution.p50Ms).toBe(60);
      expect(report.distribution.p90Ms).toBe(100);
      expect(report.distribution.p95Ms).toBe(105);
      expect(report.distribution.p99Ms).toBe(109);
      expect(report.distribution.tailAmplificationRatio).toBe(1.82);
    });

    it('calcula el jitter inter-muestra cronológico independientemente del orden del arreglo de entrada', () => {
      // Secuencia cronológica: 40 -> 60 (|20|) -> 30 (|30|) -> 70 (|40|) => jitter promedio = (20+30+40)/3 = 30ms
      const unordered: LatencyTelemetrySample[] = [
        { timestamp: new Date(baseTime.getTime() + 20_000), totalMs: 30 },
        { timestamp: new Date(baseTime.getTime() + 0), totalMs: 40 },
        { timestamp: new Date(baseTime.getTime() + 30_000), totalMs: 70 },
        { timestamp: new Date(baseTime.getTime() + 10_000), totalMs: 60 },
      ];

      const report = analytics.analyze(unordered);
      expect(report.distribution.jitterMs).toBe(30);
    });
  });

  describe('LatencyAnalyticsService - Socket Bottleneck & Anomaly Detection', () => {
    it('identifica correctamente la fase dominante de cuello de botella en el desglose de socket', () => {
      const samples: LatencyTelemetrySample[] = [
        {
          timestamp: baseTime,
          dnsLookupMs: 5,
          tcpConnectMs: 10,
          tlsHandshakeMs: 120,
          ttfbMs: 45,
          contentTransferMs: 20,
          totalMs: 200,
        },
        {
          timestamp: new Date(baseTime.getTime() + 30_000),
          dnsLookupMs: 5,
          tcpConnectMs: 10,
          tlsHandshakeMs: 140,
          ttfbMs: 35,
          contentTransferMs: 10,
          totalMs: 200,
        },
      ];

      const report = analytics.analyze(samples);
      expect(report.bottleneck.dominantPhase).toBe('TLS_HANDSHAKE');
      expect(report.bottleneck.dominantSharePercent).toBe(65);
      expect(report.bottleneck.phases.TLS_HANDSHAKE.avgMs).toBe(130);
      expect(report.bottleneck.phases.TTFB.sharePercent).toBe(20);
    });

    it('detecta picos anómalos de latencia mediante Z-Score y Modified Z-Score (MAD) sin enmascaramiento', () => {
      const baselineLatencies = [48, 50, 49, 51, 50, 52, 49, 50, 48, 51, 50, 49, 51, 50];
      const samples: LatencyTelemetrySample[] = baselineLatencies.map((ms, idx) => ({
        timestamp: new Date(baseTime.getTime() + idx * 30_000),
        totalMs: ms,
      }));

      // Insertamos un pico severo de 480ms
      const spikeTimestamp = new Date(baseTime.getTime() + 999_000);
      samples.push({
        timestamp: spikeTimestamp,
        totalMs: 480,
      });

      const report = analytics.analyze(samples);
      expect(report.anomalies).toHaveLength(1);
      expect(report.anomalies[0]?.latencyMs).toBe(480);
      expect(report.anomalies[0]?.severity).toBe('EXTREME_SPIKE');
      expect(report.anomalies[0]?.timestamp).toBe(spikeTimestamp.toISOString());
      expect(report.anomalies[0]?.modifiedZScore).toBeGreaterThan(50);
    });

    it('no genera falsos positivos de anomalías ante micro-variaciones normales de red', () => {
      const steadyLatencies = [50, 52, 49, 51, 50, 53, 48, 51, 50, 52];
      const samples: LatencyTelemetrySample[] = steadyLatencies.map((ms, idx) => ({
        timestamp: new Date(baseTime.getTime() + idx * 30_000),
        totalMs: ms,
      }));

      const report = analytics.analyze(samples);
      expect(report.anomalies).toHaveLength(0);
    });
  });
});
