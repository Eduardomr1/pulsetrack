export type ApdexZone = 'SATISFIED' | 'TOLERATING' | 'FRUSTRATED';

export type ApdexRating =
  | 'EXCELLENT'
  | 'GOOD'
  | 'FAIR'
  | 'POOR'
  | 'UNACCEPTABLE'
  | 'NO_DATA';

export interface ApdexBucketCounts {
  readonly satisfied: number;
  readonly tolerating: number;
  readonly frustrated: number;
}

export interface ApdexScoreSummary extends ApdexBucketCounts {
  readonly totalSamples: number;
  readonly satisfiedThresholdMs: number;
  readonly toleratingThresholdMs: number;
  readonly score: number;
  readonly rating: ApdexRating;
}

/**
 * Value Object que implementa el estándar abierto Apdex (Application Performance Index)
 * con umbrales [T, 4T] para cuantificar la satisfacción real del usuario frente a la latencia.
 */
export class ApdexThresholdVo {
  public readonly satisfiedThresholdMs: number;
  public readonly toleratingThresholdMs: number;

  constructor(satisfiedThresholdMs: number = 250, toleratingThresholdMs?: number) {
    if (!Number.isFinite(satisfiedThresholdMs) || satisfiedThresholdMs <= 0) {
      throw new Error('El umbral Apdex T (satisfiedThresholdMs) debe ser mayor a 0 ms');
    }

    const resolvedTolerating = toleratingThresholdMs ?? satisfiedThresholdMs * 4;
    if (!Number.isFinite(resolvedTolerating) || resolvedTolerating <= satisfiedThresholdMs) {
      throw new Error(
        `El umbral de tolerancia Apdex (${resolvedTolerating}ms) debe ser estrictamente mayor que T (${satisfiedThresholdMs}ms)`
      );
    }

    this.satisfiedThresholdMs = Number(satisfiedThresholdMs.toFixed(2));
    this.toleratingThresholdMs = Number(resolvedTolerating.toFixed(2));
  }

  public static standardWebApi(satisfiedThresholdMs: number = 250): ApdexThresholdVo {
    return new ApdexThresholdVo(satisfiedThresholdMs, satisfiedThresholdMs * 4);
  }

  public static lowLatencyEdge(satisfiedThresholdMs: number = 100): ApdexThresholdVo {
    return new ApdexThresholdVo(satisfiedThresholdMs, satisfiedThresholdMs * 4);
  }

  /**
   * Clasifica una muestra individual. Según la especificación Apdex, cualquier petición
   * fallida (HTTP 5xx, error de red o timeout) se contabiliza siempre como FRUSTRATED
   * independientemente de cuán rápido haya retornado el error.
   */
  public classifySample(latencyMs: number, isFailed: boolean = false): ApdexZone {
    if (isFailed || !Number.isFinite(latencyMs) || latencyMs < 0) {
      return 'FRUSTRATED';
    }
    if (latencyMs <= this.satisfiedThresholdMs) {
      return 'SATISFIED';
    }
    if (latencyMs <= this.toleratingThresholdMs) {
      return 'TOLERATING';
    }
    return 'FRUSTRATED';
  }

  public computeScore(counts: ApdexBucketCounts): ApdexScoreSummary {
    const satisfied = Math.max(0, Math.floor(counts.satisfied));
    const tolerating = Math.max(0, Math.floor(counts.tolerating));
    const frustrated = Math.max(0, Math.floor(counts.frustrated));
    const totalSamples = satisfied + tolerating + frustrated;

    if (totalSamples === 0) {
      return {
        satisfied: 0,
        tolerating: 0,
        frustrated: 0,
        totalSamples: 0,
        satisfiedThresholdMs: this.satisfiedThresholdMs,
        toleratingThresholdMs: this.toleratingThresholdMs,
        score: 1,
        rating: 'NO_DATA',
      };
    }

    const rawScore = (satisfied + tolerating * 0.5) / totalSamples;
    const clampedScore = Math.max(0, Math.min(1, Number(rawScore.toFixed(3))));

    return {
      satisfied,
      tolerating,
      frustrated,
      totalSamples,
      satisfiedThresholdMs: this.satisfiedThresholdMs,
      toleratingThresholdMs: this.toleratingThresholdMs,
      score: clampedScore,
      rating: ApdexThresholdVo.rateScore(clampedScore, totalSamples),
    };
  }

  public static rateScore(score: number, totalSamples: number = 1): ApdexRating {
    if (totalSamples <= 0) return 'NO_DATA';
    if (score >= 0.94) return 'EXCELLENT';
    if (score >= 0.85) return 'GOOD';
    if (score >= 0.70) return 'FAIR';
    if (score >= 0.50) return 'POOR';
    return 'UNACCEPTABLE';
  }
}
