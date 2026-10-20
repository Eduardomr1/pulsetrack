import { HealthCheckResult } from '../entities/health-check.entity';
import {
  BurnRatePolicyVo,
  BurnRateWindowPair,
  SloAlertSeverity,
  SloBurnTier,
} from '../value-objects/burn-rate-window.vo';
import { HealthStatusVo } from '../value-objects/health-status.vo';

export interface BurnRateSample {
  readonly timestamp: Date;
  readonly status: string;
}

export interface MultiWindowEvaluationOptions {
  policy?: BurnRatePolicyVo;
  evaluationTime?: Date;
  minSamplesPerShortWindow?: number;
  degradedErrorWeight?: number;
}

export interface WindowMetricsSnapshot {
  readonly windowMinutes: number;
  readonly totalSamples: number;
  readonly healthySamples: number;
  readonly degradedSamples: number;
  readonly downSamples: number;
  readonly weightedFailures: number;
  readonly observedErrorRate: number;
  readonly burnRate: number;
  readonly budgetConsumedPercent: number;
}

export interface TierBurnEvaluation {
  readonly tier: SloBurnTier;
  readonly severity: SloAlertSeverity;
  readonly thresholdMultiplier: number;
  readonly longWindow: WindowMetricsSnapshot;
  readonly shortWindow: WindowMetricsSnapshot;
  readonly hasSufficientQuorum: boolean;
  readonly isLongWindowBreached: boolean;
  readonly isShortWindowBreached: boolean;
  readonly isFiring: boolean;
  readonly description: string;
}

export interface MultiWindowBurnReport {
  readonly evaluatedAt: string;
  readonly targetSloPercentage: number;
  readonly allowedErrorRate: number;
  readonly isFiring: boolean;
  readonly highestFiringTier: SloBurnTier | null;
  readonly highestSeverity: SloAlertSeverity | null;
  readonly estimatedExhaustionHours: number | null;
  readonly tiers: readonly TierBurnEvaluation[];
  readonly summary: string;
}

/**
 * Servicio de Dominio SRE que evalúa muestras telemétricas contra múltiples pares
 * de ventanas (larga + corta de confirmación) para detectar consumo acelerado de
 * Error Budget evitando alertas obsoletas tras la recuperación (reset lag).
 */
export class MultiWindowBurnRateEvaluator {
  public static fromHealthChecks(checks: readonly HealthCheckResult[]): BurnRateSample[] {
    return checks.map((check) => ({
      timestamp: check.timestamp,
      status: check.status.value,
    }));
  }

  public evaluate(
    samples: readonly BurnRateSample[],
    options: MultiWindowEvaluationOptions = {}
  ): MultiWindowBurnReport {
    const policy = options.policy ?? BurnRatePolicyVo.googleSreDefaults();
    const evaluationTime = options.evaluationTime ?? new Date();
    const minSamples = Math.max(1, options.minSamplesPerShortWindow ?? 3);
    const degradedWeight = Math.min(1, Math.max(0, options.degradedErrorWeight ?? 0.5));

    const evalMs = evaluationTime.getTime();
    const validSamples = samples.filter((s) => {
      const t = s.timestamp.getTime();
      return Number.isFinite(t) && t <= evalMs;
    });

    const tierEvaluations: TierBurnEvaluation[] = policy.windows.map((windowPair) =>
      this.evaluateTier(validSamples, windowPair, policy, evalMs, minSamples, degradedWeight)
    );

    const activeFiring = tierEvaluations.find((t) => t.isFiring) ?? null;

    const referenceBurnRate = activeFiring
      ? activeFiring.longWindow.burnRate
      : (tierEvaluations[tierEvaluations.length - 1]?.longWindow.burnRate ?? 0);

    const complianceHours = policy.complianceMinutes / 60;
    const estimatedExhaustionHours =
      referenceBurnRate > 0
        ? Number((complianceHours / referenceBurnRate).toFixed(2))
        : null;

    const summary = activeFiring
      ? `Alerta SLO activa [${activeFiring.tier} / ${activeFiring.severity}]: burn-rate de ${activeFiring.longWindow.burnRate}x en ${activeFiring.longWindow.windowMinutes}m y ${activeFiring.shortWindow.burnRate}x en ${activeFiring.shortWindow.windowMinutes}m (umbral ${activeFiring.thresholdMultiplier}x).`
      : `Consumo de Error Budget bajo control para objetivo SLO ${policy.targetSloPercentage}%.`;

    return {
      evaluatedAt: evaluationTime.toISOString(),
      targetSloPercentage: policy.targetSloPercentage,
      allowedErrorRate: policy.allowedErrorRate,
      isFiring: activeFiring !== null,
      highestFiringTier: activeFiring ? activeFiring.tier : null,
      highestSeverity: activeFiring ? activeFiring.severity : null,
      estimatedExhaustionHours,
      tiers: Object.freeze(tierEvaluations),
      summary,
    };
  }

  private evaluateTier(
    samples: readonly BurnRateSample[],
    windowPair: BurnRateWindowPair,
    policy: BurnRatePolicyVo,
    evalMs: number,
    minSamples: number,
    degradedWeight: number
  ): TierBurnEvaluation {
    const longWindow = this.computeWindowSnapshot(
      samples,
      windowPair.longWindowMinutes,
      evalMs,
      policy,
      degradedWeight
    );

    const shortWindow = this.computeWindowSnapshot(
      samples,
      windowPair.shortWindowMinutes,
      evalMs,
      policy,
      degradedWeight
    );

    const hasSufficientQuorum =
      shortWindow.totalSamples >= minSamples && longWindow.totalSamples >= minSamples;

    const isLongWindowBreached = longWindow.burnRate >= windowPair.burnRateMultiplier;
    const isShortWindowBreached = shortWindow.burnRate >= windowPair.burnRateMultiplier;
    const isFiring = hasSufficientQuorum && isLongWindowBreached && isShortWindowBreached;

    return {
      tier: windowPair.tier,
      severity: windowPair.severity,
      thresholdMultiplier: windowPair.burnRateMultiplier,
      longWindow,
      shortWindow,
      hasSufficientQuorum,
      isLongWindowBreached,
      isShortWindowBreached,
      isFiring,
      description: windowPair.description,
    };
  }

  private computeWindowSnapshot(
    samples: readonly BurnRateSample[],
    windowMinutes: number,
    evalMs: number,
    policy: BurnRatePolicyVo,
    degradedWeight: number
  ): WindowMetricsSnapshot {
    const cutoffMs = evalMs - windowMinutes * 60 * 1000;
    let healthySamples = 0;
    let degradedSamples = 0;
    let downSamples = 0;

    for (const sample of samples) {
      if (sample.timestamp.getTime() < cutoffMs) {
        continue;
      }

      const vo = HealthStatusVo.fromString(sample.status);
      if (vo.isDown()) {
        downSamples += 1;
      } else if (vo.isDegraded()) {
        degradedSamples += 1;
      } else if (vo.isHealthy()) {
        healthySamples += 1;
      }
    }

    const totalSamples = healthySamples + degradedSamples + downSamples;
    const weightedFailures = Number(
      (downSamples + degradedSamples * degradedWeight).toFixed(4)
    );

    const observedErrorRate =
      totalSamples > 0 ? Number((weightedFailures / totalSamples).toFixed(6)) : 0;

    const burnRate =
      policy.allowedErrorRate > 0 && totalSamples > 0
        ? Number(((weightedFailures / totalSamples) / policy.allowedErrorRate).toFixed(2))
        : 0;

    const budgetConsumedPercent = policy.calculateBudgetConsumedInWindowPercent(
      windowMinutes,
      burnRate
    );

    return {
      windowMinutes,
      totalSamples,
      healthySamples,
      degradedSamples,
      downSamples,
      weightedFailures,
      observedErrorRate,
      burnRate,
      budgetConsumedPercent,
    };
  }
}
