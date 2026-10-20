import { HealthCheckResult } from '../entities/health-check.entity';
import {
  ApdexScoreSummary,
  ApdexThresholdVo,
} from '../value-objects/apdex-threshold.vo';

export type SocketPhaseName =
  | 'DNS_LOOKUP'
  | 'TCP_CONNECT'
  | 'TLS_HANDSHAKE'
  | 'TTFB'
  | 'CONTENT_TRANSFER';

export interface LatencyTelemetrySample {
  readonly timestamp: Date;
  readonly totalMs: number;
  readonly isFailed?: boolean;
  readonly dnsLookupMs?: number;
  readonly tcpConnectMs?: number;
  readonly tlsHandshakeMs?: number;
  readonly ttfbMs?: number;
  readonly contentTransferMs?: number;
}

export interface LatencyPercentilesSummary {
  readonly sampleCount: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly stdDevMs: number;
  readonly jitterMs: number;
  readonly coefficientOfVariation: number;
  readonly tailAmplificationRatio: number;
}

export interface PhaseContributionMetric {
  readonly avgMs: number;
  readonly sharePercent: number;
}

export interface SocketBottleneckBreakdown {
  readonly dominantPhase: SocketPhaseName | null;
  readonly dominantSharePercent: number;
  readonly phases: Readonly<Record<SocketPhaseName, PhaseContributionMetric>>;
}

export interface LatencySpikeAnomaly {
  readonly timestamp: string;
  readonly latencyMs: number;
  readonly zScore: number;
  readonly modifiedZScore: number;
  readonly severity: 'MODERATE_SPIKE' | 'EXTREME_SPIKE';
}

export interface LatencyAnalyticsOptions {
  apdexThreshold?: ApdexThresholdVo;
  zScoreThreshold?: number;
  modifiedZScoreThreshold?: number;
  minSamplesForAnomalyDetection?: number;
  minSpikeDeltaMs?: number;
}

export interface LatencyAnalyticsReport {
  readonly distribution: LatencyPercentilesSummary;
  readonly apdex: ApdexScoreSummary;
  readonly bottleneck: SocketBottleneckBreakdown;
  readonly anomalies: readonly LatencySpikeAnomaly[];
}

/**
 * Servicio de Dominio para analítica estadística avanzada de latencia:
 * - Percentiles continuos interpolados (p50, p90, p95, p99) y amplificación de cola (p99/p50)
 * - Jitter inter-muestra estilo RFC 3550 y desviación estándar
 * - Índice de satisfacción Apdex [T, 4T]
 * - Atribución de cuello de botella por fase de socket (DNS, TCP, TLS, TTFB, Transfer)
 * - Detección robusta de anomalías (picos de latencia) vía Z-Score paramétrico y MAD
 */
export class LatencyAnalyticsService {
  public static fromHealthChecks(
    checks: readonly HealthCheckResult[]
  ): LatencyTelemetrySample[] {
    return checks.map((check) => ({
      timestamp: check.timestamp,
      totalMs: check.latency.totalMs,
      isFailed: check.isFailed(),
      dnsLookupMs: check.latency.dnsLookupMs,
      tcpConnectMs: check.latency.tcpConnectMs,
      tlsHandshakeMs: check.latency.tlsHandshakeMs,
      ttfbMs: check.latency.ttfbMs,
      contentTransferMs: check.latency.contentTransferMs,
    }));
  }

  public analyze(
    samples: readonly LatencyTelemetrySample[],
    options: LatencyAnalyticsOptions = {}
  ): LatencyAnalyticsReport {
    const apdexVo = options.apdexThreshold ?? ApdexThresholdVo.standardWebApi(250);
    const zThreshold = options.zScoreThreshold ?? 2.5;
    const modZThreshold = options.modifiedZScoreThreshold ?? 3.5;
    const minAnomalySamples = Math.max(4, options.minSamplesForAnomalyDetection ?? 5);
    const minSpikeDeltaMs = Math.max(0, options.minSpikeDeltaMs ?? 15);

    const chronological = [...samples]
      .filter((s) => Number.isFinite(s.totalMs) && s.totalMs >= 0)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const apdex = this.computeApdexSummary(chronological, apdexVo);
    const operationalSamples = chronological.filter((s) => !s.isFailed);
    const latencyPool = operationalSamples.length > 0 ? operationalSamples : chronological;

    const distribution = this.computeDistribution(latencyPool);
    const bottleneck = this.computeSocketBottleneck(latencyPool);
    const anomalies = this.detectLatencyAnomalies(
      latencyPool,
      distribution,
      zThreshold,
      modZThreshold,
      minAnomalySamples,
      minSpikeDeltaMs
    );

    return {
      distribution,
      apdex,
      bottleneck,
      anomalies: Object.freeze(anomalies),
    };
  }

  public static calculateInterpolatedPercentile(
    sortedValues: readonly number[],
    percentile: number
  ): number {
    const n = sortedValues.length;
    if (n === 0) return 0;
    if (n === 1) return Number((sortedValues[0] ?? 0).toFixed(2));

    const clampedPct = Math.max(0, Math.min(100, percentile));
    const rank = (clampedPct / 100) * (n - 1);
    const lowerIdx = Math.floor(rank);
    const upperIdx = Math.ceil(rank);
    const weight = rank - lowerIdx;

    const lowerVal = sortedValues[lowerIdx] ?? 0;
    const upperVal = sortedValues[upperIdx] ?? lowerVal;
    return Number((lowerVal + (upperVal - lowerVal) * weight).toFixed(2));
  }

  private computeApdexSummary(
    samples: readonly LatencyTelemetrySample[],
    apdexVo: ApdexThresholdVo
  ): ApdexScoreSummary {
    let satisfied = 0;
    let tolerating = 0;
    let frustrated = 0;

    for (const s of samples) {
      const zone = apdexVo.classifySample(s.totalMs, Boolean(s.isFailed));
      if (zone === 'SATISFIED') satisfied += 1;
      else if (zone === 'TOLERATING') tolerating += 1;
      else frustrated += 1;
    }

    return apdexVo.computeScore({ satisfied, tolerating, frustrated });
  }

  private computeDistribution(
    chronologicalSamples: readonly LatencyTelemetrySample[]
  ): LatencyPercentilesSummary {
    const n = chronologicalSamples.length;
    if (n === 0) {
      return {
        sampleCount: 0,
        minMs: 0,
        maxMs: 0,
        meanMs: 0,
        p50Ms: 0,
        p90Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        stdDevMs: 0,
        jitterMs: 0,
        coefficientOfVariation: 0,
        tailAmplificationRatio: 1,
      };
    }

    const rawValues = chronologicalSamples.map((s) => s.totalMs);
    const sorted = [...rawValues].sort((a, b) => a - b);

    const sum = rawValues.reduce((acc, v) => acc + v, 0);
    const mean = sum / n;

    const variance =
      rawValues.reduce((acc, v) => {
        const diff = v - mean;
        return acc + diff * diff;
      }, 0) / n;
    const stdDev = Math.sqrt(variance);

    let jitterSum = 0;
    for (let i = 1; i < rawValues.length; i += 1) {
      const curr = rawValues[i] ?? 0;
      const prev = rawValues[i - 1] ?? 0;
      jitterSum += Math.abs(curr - prev);
    }
    const jitter = rawValues.length > 1 ? jitterSum / (rawValues.length - 1) : 0;

    const minMs = Number((sorted[0] ?? 0).toFixed(2));
    const maxMs = Number((sorted[n - 1] ?? 0).toFixed(2));
    const p50Ms = LatencyAnalyticsService.calculateInterpolatedPercentile(sorted, 50);
    const p90Ms = LatencyAnalyticsService.calculateInterpolatedPercentile(sorted, 90);
    const p95Ms = LatencyAnalyticsService.calculateInterpolatedPercentile(sorted, 95);
    const p99Ms = LatencyAnalyticsService.calculateInterpolatedPercentile(sorted, 99);

    const coefficientOfVariation = mean > 0 ? Number((stdDev / mean).toFixed(3)) : 0;
    const tailAmplificationRatio = p50Ms > 0 ? Number((p99Ms / p50Ms).toFixed(2)) : 1;

    return {
      sampleCount: n,
      minMs,
      maxMs,
      meanMs: Number(mean.toFixed(2)),
      p50Ms,
      p90Ms,
      p95Ms,
      p99Ms,
      stdDevMs: Number(stdDev.toFixed(2)),
      jitterMs: Number(jitter.toFixed(2)),
      coefficientOfVariation,
      tailAmplificationRatio,
    };
  }

  private computeSocketBottleneck(
    samples: readonly LatencyTelemetrySample[]
  ): SocketBottleneckBreakdown {
    const emptyPhases: Record<SocketPhaseName, PhaseContributionMetric> = {
      DNS_LOOKUP: { avgMs: 0, sharePercent: 0 },
      TCP_CONNECT: { avgMs: 0, sharePercent: 0 },
      TLS_HANDSHAKE: { avgMs: 0, sharePercent: 0 },
      TTFB: { avgMs: 0, sharePercent: 0 },
      CONTENT_TRANSFER: { avgMs: 0, sharePercent: 0 },
    };

    if (samples.length === 0) {
      return {
        dominantPhase: null,
        dominantSharePercent: 0,
        phases: Object.freeze(emptyPhases),
      };
    }

    let dnsSum = 0;
    let tcpSum = 0;
    let tlsSum = 0;
    let ttfbSum = 0;
    let transferSum = 0;

    for (const s of samples) {
      dnsSum += Math.max(0, s.dnsLookupMs ?? 0);
      tcpSum += Math.max(0, s.tcpConnectMs ?? 0);
      tlsSum += Math.max(0, s.tlsHandshakeMs ?? 0);
      ttfbSum += Math.max(0, s.ttfbMs ?? 0);
      transferSum += Math.max(0, s.contentTransferMs ?? 0);
    }

    const n = samples.length;
    const averages: Record<SocketPhaseName, number> = {
      DNS_LOOKUP: dnsSum / n,
      TCP_CONNECT: tcpSum / n,
      TLS_HANDSHAKE: tlsSum / n,
      TTFB: ttfbSum / n,
      CONTENT_TRANSFER: transferSum / n,
    };

    const compositeSum =
      averages.DNS_LOOKUP +
      averages.TCP_CONNECT +
      averages.TLS_HANDSHAKE +
      averages.TTFB +
      averages.CONTENT_TRANSFER;

    if (compositeSum <= 0) {
      return {
        dominantPhase: null,
        dominantSharePercent: 0,
        phases: Object.freeze(emptyPhases),
      };
    }

    const phaseKeys: SocketPhaseName[] = [
      'DNS_LOOKUP',
      'TCP_CONNECT',
      'TLS_HANDSHAKE',
      'TTFB',
      'CONTENT_TRANSFER',
    ];

    let dominantPhase: SocketPhaseName = 'TTFB';
    let dominantSharePercent = -1;

    const phases = {} as Record<SocketPhaseName, PhaseContributionMetric>;
    for (const key of phaseKeys) {
      const avgVal = averages[key];
      const share = Number(((avgVal / compositeSum) * 100).toFixed(1));
      phases[key] = {
        avgMs: Number(avgVal.toFixed(2)),
        sharePercent: share,
      };
      if (share > dominantSharePercent) {
        dominantSharePercent = share;
        dominantPhase = key;
      }
    }

    return {
      dominantPhase,
      dominantSharePercent,
      phases: Object.freeze(phases),
    };
  }

  private detectLatencyAnomalies(
    chronologicalSamples: readonly LatencyTelemetrySample[],
    distribution: LatencyPercentilesSummary,
    zThreshold: number,
    modZThreshold: number,
    minSamples: number,
    minSpikeDeltaMs: number
  ): LatencySpikeAnomaly[] {
    if (chronologicalSamples.length < minSamples || distribution.stdDevMs === 0) {
      return [];
    }

    const median = distribution.p50Ms;
    const absDeviations = chronologicalSamples
      .map((s) => Math.abs(s.totalMs - median))
      .sort((a, b) => a - b);

    const mad = LatencyAnalyticsService.calculateInterpolatedPercentile(absDeviations, 50);
    const meanAbsDeviation =
      absDeviations.reduce((acc, v) => acc + v, 0) / absDeviations.length;

    const anomalies: LatencySpikeAnomaly[] = [];

    for (const sample of chronologicalSamples) {
      const deltaFromMedian = sample.totalMs - median;
      const deltaFromMean = sample.totalMs - distribution.meanMs;

      if (deltaFromMedian <= minSpikeDeltaMs || deltaFromMean <= 0) {
        continue;
      }

      const zScore = Number((deltaFromMean / distribution.stdDevMs).toFixed(2));
      const scaleDenominator = mad > 0 ? mad : meanAbsDeviation * 1.2533;
      const modifiedZScore =
        scaleDenominator > 0
          ? Number(((0.6745 * deltaFromMedian) / scaleDenominator).toFixed(2))
          : zScore;

      if (zScore >= zThreshold || modifiedZScore >= modZThreshold) {
        const severity: LatencySpikeAnomaly['severity'] =
          zScore >= 3.5 || modifiedZScore >= 5.0 ? 'EXTREME_SPIKE' : 'MODERATE_SPIKE';

        anomalies.push({
          timestamp: sample.timestamp.toISOString(),
          latencyMs: Number(sample.totalMs.toFixed(2)),
          zScore,
          modifiedZScore,
          severity,
        });
      }
    }

    return anomalies;
  }
}
