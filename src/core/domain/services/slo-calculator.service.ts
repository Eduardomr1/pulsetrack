export interface SloCalculationParams {
  totalChecks: number;
  healthyChecks: number;
  degradedChecks: number;
  downChecks: number;
  targetSloPercentage?: number; // e.g. 99.9
  windowDays?: number; // e.g. 30
  checkIntervalSeconds: number; // e.g. 30
}

export type BurnStatus = 'HEALTHY' | 'ELEVATED' | 'CRITICAL';

export interface SloReport {
  targetSloPercentage: number;
  currentAvailabilityPercentage: number;
  windowDays: number;
  windowMinutes: number;
  allowedDowntimeMinutes: number;
  consumedDowntimeMinutes: number;
  remainingBudgetMinutes: number;
  remainingBudgetPercentage: number;
  burnRate: number;
  burnStatus: BurnStatus;
  isBreached: boolean;
  downtimeEstimateExplanation: string;
}

export class SloCalculatorService {
  /**
   * Calculates Site Reliability Engineering (SRE) Service Level Objectives & Error Budget
   * based on Google SRE Workbook principles.
   */
  public static calculate(params: SloCalculationParams): SloReport {
    const targetSlo = params.targetSloPercentage ?? 99.9;
    const windowDays = params.windowDays ?? 30;
    const intervalSec = Math.max(5, params.checkIntervalSeconds);

    const total = params.totalChecks;
    const healthy = params.healthyChecks;
    const down = params.downChecks;

    // Availability: Degraded checks contribute 50% availability in composite SLA
    const effectiveSuccessful = healthy + (params.degradedChecks * 0.5);
    const currentAvailability = total > 0 ? (effectiveSuccessful / total) * 100 : 100;

    const windowMinutes = windowDays * 24 * 60;
    const allowedDowntimeFraction = (100 - targetSlo) / 100;
    const allowedDowntimeMinutes = Number((windowMinutes * allowedDowntimeFraction).toFixed(2));

    // Consumed downtime: based on down checks duration + 50% degraded checks duration
    const consumedSeconds = (down * intervalSec) + (params.degradedChecks * intervalSec * 0.5);
    const consumedDowntimeMinutes = Number((consumedSeconds / 60).toFixed(2));

    const remainingBudgetMinutes = Math.max(0, Number((allowedDowntimeMinutes - consumedDowntimeMinutes).toFixed(2)));
    const remainingBudgetPercentage = allowedDowntimeMinutes > 0
      ? Math.max(0, Math.min(100, Number(((remainingBudgetMinutes / allowedDowntimeMinutes) * 100).toFixed(1))))
      : 0;

    // Burn Rate Calculation:
    // Burn Rate = (Observed Failure Rate) / (Allowed Error Rate)
    // 1x Burn Rate = Error budget will be exactly exhausted in 30 days.
    // >1x = Faster consumption. 14x = 100% budget consumed in 2 days.
    const observedFailureRate = total > 0 ? (total - effectiveSuccessful) / total : 0;
    const allowedErrorRate = allowedDowntimeFraction;
    const burnRate = allowedErrorRate > 0
      ? Number((observedFailureRate / allowedErrorRate).toFixed(2))
      : 0;

    let burnStatus: BurnStatus = 'HEALTHY';
    if (burnRate > 5.0 || remainingBudgetPercentage < 10) {
      burnStatus = 'CRITICAL';
    } else if (burnRate > 1.0 || remainingBudgetPercentage < 40) {
      burnStatus = 'ELEVATED';
    }

    const isBreached = currentAvailability < targetSlo;

    return {
      targetSloPercentage: targetSlo,
      currentAvailabilityPercentage: Number(currentAvailability.toFixed(3)),
      windowDays,
      windowMinutes,
      allowedDowntimeMinutes,
      consumedDowntimeMinutes,
      remainingBudgetMinutes,
      remainingBudgetPercentage,
      burnRate,
      burnStatus,
      isBreached,
      downtimeEstimateExplanation: `Para un SLA de ${targetSlo}%, se permite un máximo de ${allowedDowntimeMinutes} min de inactividad cada ${windowDays} días.`,
    };
  }
}
