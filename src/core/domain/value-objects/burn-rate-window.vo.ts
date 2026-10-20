export type SloBurnTier = 'PAGE_FAST' | 'PAGE_SLOW' | 'TICKET';
export type SloAlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface BurnRateWindowPair {
  readonly tier: SloBurnTier;
  readonly severity: SloAlertSeverity;
  readonly longWindowMinutes: number;
  readonly shortWindowMinutes: number;
  readonly burnRateMultiplier: number;
  readonly description: string;
}

export interface BurnRatePolicyProps {
  targetSloPercentage: number;
  complianceDays?: number;
  windows?: readonly BurnRateWindowPair[];
}

const TIER_PRIORITY: Record<SloBurnTier, number> = {
  PAGE_FAST: 3,
  PAGE_SLOW: 2,
  TICKET: 1,
};

/**
 * Value Object que modela políticas Multi-Window Multi-Burn-Rate
 * basadas en el capítulo 5 ("Alerting on SLOs") del Google SRE Workbook.
 */
export class BurnRatePolicyVo {
  public readonly targetSloPercentage: number;
  public readonly complianceDays: number;
  public readonly complianceMinutes: number;
  public readonly allowedErrorRate: number;
  public readonly allowedDowntimeMinutes: number;
  public readonly windows: readonly BurnRateWindowPair[];

  constructor(props: BurnRatePolicyProps) {
    if (
      !Number.isFinite(props.targetSloPercentage) ||
      props.targetSloPercentage <= 0 ||
      props.targetSloPercentage >= 100
    ) {
      throw new Error('El objetivo SLO debe estar estrictamente entre 0% y 100%');
    }

    const complianceDays = props.complianceDays ?? 30;
    if (!Number.isFinite(complianceDays) || complianceDays < 1) {
      throw new Error('La ventana de cumplimiento SLO debe ser de al menos 1 día');
    }

    const candidateWindows =
      props.windows && props.windows.length > 0
        ? props.windows
        : BurnRatePolicyVo.buildDefaultWindows();

    for (const win of candidateWindows) {
      if (win.shortWindowMinutes <= 0 || win.longWindowMinutes <= 0) {
        throw new Error('Las ventanas de evaluación de burn-rate deben ser mayores a 0 minutos');
      }
      if (win.shortWindowMinutes >= win.longWindowMinutes) {
        throw new Error(
          `La ventana corta (${win.shortWindowMinutes}m) debe ser estrictamente menor que la ventana larga (${win.longWindowMinutes}m)`
        );
      }
      if (!Number.isFinite(win.burnRateMultiplier) || win.burnRateMultiplier <= 0) {
        throw new Error('El multiplicador de burn-rate debe ser un número positivo');
      }
    }

    this.targetSloPercentage = props.targetSloPercentage;
    this.complianceDays = complianceDays;
    this.complianceMinutes = complianceDays * 24 * 60;
    this.allowedErrorRate = (100 - props.targetSloPercentage) / 100;
    this.allowedDowntimeMinutes = Number(
      (this.complianceMinutes * this.allowedErrorRate).toFixed(2)
    );

    const sortedWindows = [...candidateWindows].sort((a, b) => {
      const priorityDiff = TIER_PRIORITY[b.tier] - TIER_PRIORITY[a.tier];
      if (priorityDiff !== 0) return priorityDiff;
      return b.burnRateMultiplier - a.burnRateMultiplier;
    });

    this.windows = Object.freeze(sortedWindows.map((w) => Object.freeze({ ...w })));
  }

  /**
   * Construye la política canónica del Google SRE Workbook para ventanas de 30 días:
   * - PAGE_FAST (1h / 5m @ 14.4x): 2% del error budget consumido en 1 hora.
   * - PAGE_SLOW (6h / 30m @ 6.0x): 5% del error budget consumido en 6 horas.
   * - TICKET    (24h / 120m @ 3.0x): 10% del error budget consumido en 24 horas.
   */
  public static googleSreDefaults(
    targetSloPercentage: number = 99.9,
    complianceDays: number = 30
  ): BurnRatePolicyVo {
    return new BurnRatePolicyVo({
      targetSloPercentage,
      complianceDays,
      windows: BurnRatePolicyVo.buildDefaultWindows(),
    });
  }

  private static buildDefaultWindows(): BurnRateWindowPair[] {
    return [
      {
        tier: 'PAGE_FAST',
        severity: 'CRITICAL',
        longWindowMinutes: 60,
        shortWindowMinutes: 5,
        burnRateMultiplier: 14.4,
        description: 'Consumo crítico acelerado (2% del presupuesto mensual en 1 hora)',
      },
      {
        tier: 'PAGE_SLOW',
        severity: 'WARNING',
        longWindowMinutes: 360,
        shortWindowMinutes: 30,
        burnRateMultiplier: 6.0,
        description: 'Consumo sostenido elevado (5% del presupuesto mensual en 6 horas)',
      },
      {
        tier: 'TICKET',
        severity: 'INFO',
        longWindowMinutes: 1440,
        shortWindowMinutes: 120,
        burnRateMultiplier: 3.0,
        description: 'Degradación progresiva de presupuesto (10% del presupuesto mensual en 24 horas)',
      },
    ];
  }

  public getMaxLookbackMinutes(): number {
    return this.windows.reduce(
      (max, win) => (win.longWindowMinutes > max ? win.longWindowMinutes : max),
      0
    );
  }

  public calculateBudgetConsumedInWindowPercent(
    windowMinutes: number,
    observedBurnRate: number
  ): number {
    if (windowMinutes <= 0 || observedBurnRate <= 0 || this.complianceMinutes <= 0) {
      return 0;
    }
    const percent = ((observedBurnRate * windowMinutes) / this.complianceMinutes) * 100;
    return Number(Math.max(0, percent).toFixed(2));
  }

  public getThresholdErrorRateForTier(tier: SloBurnTier): number {
    const found = this.windows.find((w) => w.tier === tier);
    if (!found) {
      throw new Error(`Nivel de burn-rate no configurado en la política: ${tier}`);
    }
    return Math.min(1, this.allowedErrorRate * found.burnRateMultiplier);
  }

  public static compareTierPriority(a: SloBurnTier, b: SloBurnTier): number {
    return TIER_PRIORITY[a] - TIER_PRIORITY[b];
  }
}
