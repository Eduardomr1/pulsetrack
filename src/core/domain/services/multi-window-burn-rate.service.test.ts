import { describe, it, expect } from 'vitest';
import { BurnRatePolicyVo } from '../value-objects/burn-rate-window.vo';
import {
  BurnRateSample,
  MultiWindowBurnRateEvaluator,
} from './multi-window-burn-rate.service';
import { SloAlertStateMachine } from './slo-alert-deduplicator.service';

function generateWindowSamples(params: {
  referenceTime: Date;
  fromMinutesAgo: number;
  toMinutesAgo: number;
  stepMinutes: number;
  downEveryN?: number;
  allStatus?: string;
}): BurnRateSample[] {
  const samples: BurnRateSample[] = [];
  const refMs = params.referenceTime.getTime();
  let index = 0;

  for (let m = params.fromMinutesAgo; m > params.toMinutesAgo; m -= params.stepMinutes) {
    const timestamp = new Date(refMs - m * 60 * 1000);
    let status = params.allStatus ?? 'HEALTHY';
    if (params.downEveryN && params.downEveryN > 0 && index % params.downEveryN === 0) {
      status = 'DOWN';
    }
    samples.push({ timestamp, status });
    index += 1;
  }

  return samples;
}

describe('Multi-Window Multi-Burn-Rate SLO Engine & Alert Deduplicator', () => {
  const refTime = new Date('2026-10-20T12:00:00.000Z');
  const evaluator = new MultiWindowBurnRateEvaluator();

  describe('BurnRatePolicyVo', () => {
    it('calcula exactamente los porcentajes de consumo de presupuesto del Google SRE Workbook (2%, 5%, 10%)', () => {
      const policy = BurnRatePolicyVo.googleSreDefaults(99.9, 30);

      expect(policy.allowedErrorRate).toBeCloseTo(0.001, 6);
      expect(policy.allowedDowntimeMinutes).toBe(43.2);
      expect(policy.getMaxLookbackMinutes()).toBe(1440);

      // 14.4x en 60m sobre ventana de 30 días (43200m) -> 2.0% del error budget
      expect(policy.calculateBudgetConsumedInWindowPercent(60, 14.4)).toBe(2);
      // 6.0x en 360m (6h) -> 5.0% del error budget
      expect(policy.calculateBudgetConsumedInWindowPercent(360, 6.0)).toBe(5);
      // 3.0x en 1440m (24h) -> 10.0% del error budget
      expect(policy.calculateBudgetConsumedInWindowPercent(1440, 3.0)).toBe(10);
    });

    it('rechaza objetivos SLO fuera del rango (0, 100) o ventanas invertidas', () => {
      expect(() => new BurnRatePolicyVo({ targetSloPercentage: 100 })).toThrow();
      expect(() => new BurnRatePolicyVo({ targetSloPercentage: 0 })).toThrow();
      expect(
        () =>
          new BurnRatePolicyVo({
            targetSloPercentage: 99.9,
            windows: [
              {
                tier: 'PAGE_FAST',
                severity: 'CRITICAL',
                longWindowMinutes: 30,
                shortWindowMinutes: 30,
                burnRateMultiplier: 14.4,
                description: 'Inválida',
              },
            ],
          })
      ).toThrow();
    });
  });

  describe('MultiWindowBurnRateEvaluator', () => {
    it('reporta estado saludable sin disparo cuando todas las muestras son HEALTHY', () => {
      const samples = generateWindowSamples({
        referenceTime: refTime,
        fromMinutesAgo: 120,
        toMinutesAgo: 0,
        stepMinutes: 1,
        allStatus: 'HEALTHY',
      });

      const report = evaluator.evaluate(samples, { evaluationTime: refTime });

      expect(report.isFiring).toBe(false);
      expect(report.highestFiringTier).toBeNull();
      expect(report.estimatedExhaustionHours).toBeNull();
    });

    it('dispara PAGE_FAST (CRITICAL) cuando las ventanas de 1h y 5m superan 14.4x simultáneamente', () => {
      // 1 fallo cada 50 muestras = 2.0% error rate -> para SLO 99.9% (0.1% permitido) = 20.0x burn rate
      const samples = generateWindowSamples({
        referenceTime: refTime,
        fromMinutesAgo: 60,
        toMinutesAgo: 0,
        stepMinutes: 0.5, // 120 muestras en 60m, 10 muestras en 5m
        downEveryN: 10, // 10% error rate -> 100x burn rate
      });

      const report = evaluator.evaluate(samples, {
        evaluationTime: refTime,
        policy: BurnRatePolicyVo.googleSreDefaults(99.9, 30),
      });

      expect(report.isFiring).toBe(true);
      expect(report.highestFiringTier).toBe('PAGE_FAST');
      expect(report.highestSeverity).toBe('CRITICAL');
      // 100x burn rate agota 720h en 7.2h
      expect(report.estimatedExhaustionHours).toBe(7.2);
    });

    it('cancela inmediatamente la alerta (evita reset lag) cuando la ventana corta de 5m se recupera aunque 1h siga alta', () => {
      // Historial saludable de 24h salvo un micro-corte de 2 minutos ocurrido hace 15 minutos (t-16m y t-15m).
      // En 1h (60 muestras): 2 fallos -> 3.33% error -> 33.33x burn rate (>= 14.4x, ventana larga violada).
      // En 5m (5 muestras): 0 fallos -> 0x burn rate (ventana corta ya recuperada).
      // En 6h (360 muestras): 2/360 -> 5.56x (< 6.0x) y en 24h (1440 muestras): 2/1440 -> 1.39x (< 3.0x).
      const baseline24h = generateWindowSamples({
        referenceTime: refTime,
        fromMinutesAgo: 1440,
        toMinutesAgo: 0,
        stepMinutes: 1,
        allStatus: 'HEALTHY',
      }).map((sample) => {
        const minsAgo = Math.round((refTime.getTime() - sample.timestamp.getTime()) / 60_000);
        if (minsAgo === 15 || minsAgo === 16) {
          return { ...sample, status: 'DOWN' };
        }
        return sample;
      });

      const report = evaluator.evaluate(baseline24h, {
        evaluationTime: refTime,
        policy: BurnRatePolicyVo.googleSreDefaults(99.9, 30),
      });

      const fastTier = report.tiers.find((t) => t.tier === 'PAGE_FAST');
      expect(fastTier?.isLongWindowBreached).toBe(true);
      expect(fastTier?.isShortWindowBreached).toBe(false);
      expect(fastTier?.isFiring).toBe(false);
      expect(report.isFiring).toBe(false);
    });

    it('dispara PAGE_SLOW (WARNING) para consumo moderado sostenido de 8x durante 6h y 30m', () => {
      // SLO 99% -> allowedErrorRate = 0.01 (1%). 1 fallo cada 12 muestras = 8.33% error -> ~8.33x burn rate (>= 6x y < 14.4x)
      const samples = generateWindowSamples({
        referenceTime: refTime,
        fromMinutesAgo: 360,
        toMinutesAgo: 0,
        stepMinutes: 1,
        downEveryN: 12,
      });

      const report = evaluator.evaluate(samples, {
        evaluationTime: refTime,
        policy: BurnRatePolicyVo.googleSreDefaults(99.0, 30),
      });

      expect(report.isFiring).toBe(true);
      expect(report.highestFiringTier).toBe('PAGE_SLOW');
      expect(report.highestSeverity).toBe('WARNING');
    });

    it('dispara TICKET (INFO) para degradación lenta de 4x durante 24h y 2h', () => {
      // SLO 99% -> allowedErrorRate = 0.01. 1 fallo cada 25 muestras = 4.0% error -> 4.0x burn rate (>= 3x y < 6x)
      const samples = generateWindowSamples({
        referenceTime: refTime,
        fromMinutesAgo: 1440,
        toMinutesAgo: 0,
        stepMinutes: 2,
        downEveryN: 25,
      });

      const report = evaluator.evaluate(samples, {
        evaluationTime: refTime,
        policy: BurnRatePolicyVo.googleSreDefaults(99.0, 30),
      });

      expect(report.isFiring).toBe(true);
      expect(report.highestFiringTier).toBe('TICKET');
      expect(report.highestSeverity).toBe('INFO');
    });

    it('protege contra falsos positivos en arranque en frío si no se cumple el quórum mínimo de muestras', () => {
      const sparseSamples: BurnRateSample[] = [
        { timestamp: new Date(refTime.getTime() - 60_000), status: 'DOWN' },
        { timestamp: new Date(refTime.getTime() - 30_000), status: 'DOWN' },
      ];

      const report = evaluator.evaluate(sparseSamples, {
        evaluationTime: refTime,
        minSamplesPerShortWindow: 5,
      });

      expect(report.isFiring).toBe(false);
      expect(report.tiers[0]?.hasSufficientQuorum).toBe(false);
    });

    it('pondera estados DEGRADED al 50% de peso de error por defecto', () => {
      // 100% DEGRADED con peso 0.5 -> 50% error efectivo -> sobre SLO 95% (5% permitido) = 10x burn rate
      const degradedSamples = generateWindowSamples({
        referenceTime: refTime,
        fromMinutesAgo: 360,
        toMinutesAgo: 0,
        stepMinutes: 2,
        allStatus: 'DEGRADED',
      });

      const report = evaluator.evaluate(degradedSamples, {
        evaluationTime: refTime,
        policy: BurnRatePolicyVo.googleSreDefaults(95.0, 30),
      });

      const slowTier = report.tiers.find((t) => t.tier === 'PAGE_SLOW');
      expect(slowTier?.longWindow.burnRate).toBe(10);
      expect(report.highestFiringTier).toBe('PAGE_SLOW');
    });
  });

  describe('SloAlertStateMachine', () => {
    const buildMockReport = (
      at: Date,
      tier: 'PAGE_FAST' | 'PAGE_SLOW' | 'TICKET' | null
    ) => {
      const severityMap = {
        PAGE_FAST: 'CRITICAL',
        PAGE_SLOW: 'WARNING',
        TICKET: 'INFO',
      } as const;

      return {
        evaluatedAt: at.toISOString(),
        targetSloPercentage: 99.9,
        allowedErrorRate: 0.001,
        isFiring: tier !== null,
        highestFiringTier: tier,
        highestSeverity: tier ? severityMap[tier] : null,
        estimatedExhaustionHours: tier ? 12 : null,
        tiers: [],
        summary: 'Mock evaluation',
      };
    };

    it('dispara en primera violación, suprime duplicados y escala inmediatamente ante un tier superior', () => {
      const sm = new SloAlertStateMachine({ cooldownMinutes: 15 });
      const t0 = new Date('2026-10-20T12:00:00Z');
      const t1 = new Date('2026-10-20T12:01:00Z');
      const t2 = new Date('2026-10-20T12:02:00Z');

      const d0 = sm.processEvaluation('ep-1', buildMockReport(t0, 'TICKET'), t0);
      expect(d0.action).toBe('DISPATCH_FIRING');
      expect(d0.shouldNotify).toBe(true);

      const d1 = sm.processEvaluation('ep-1', buildMockReport(t1, 'TICKET'), t1);
      expect(d1.action).toBe('SUPPRESS_DUPLICATE');
      expect(d1.shouldNotify).toBe(false);
      expect(d1.nextState.suppressedCount).toBe(1);

      const d2 = sm.processEvaluation('ep-1', buildMockReport(t2, 'PAGE_FAST'), t2);
      expect(d2.action).toBe('DISPATCH_ESCALATION');
      expect(d2.shouldNotify).toBe(true);
      expect(d2.nextState.peakTierInEpisode).toBe('PAGE_FAST');
    });

    it('emite resolución, suprime rebotes del mismo nivel en cooldown y permite bypass por escalamiento', () => {
      const sm = new SloAlertStateMachine({ cooldownMinutes: 15 });
      const t0 = new Date('2026-10-20T12:00:00Z');
      const tResolve = new Date('2026-10-20T12:10:00Z');
      const tBounce = new Date('2026-10-20T12:15:00Z'); // +5m dentro de cooldown de 15m
      const tEscalate = new Date('2026-10-20T12:18:00Z'); // +8m dentro de cooldown pero PAGE_FAST > PAGE_SLOW

      sm.processEvaluation('ep-2', buildMockReport(t0, 'PAGE_SLOW'), t0);

      const resolved = sm.processEvaluation('ep-2', buildMockReport(tResolve, null), tResolve);
      expect(resolved.action).toBe('DISPATCH_RESOLVED');
      expect(resolved.shouldNotify).toBe(true);
      expect(resolved.nextState.phase).toBe('COOLDOWN');

      const bounced = sm.processEvaluation('ep-2', buildMockReport(tBounce, 'PAGE_SLOW'), tBounce);
      expect(bounced.action).toBe('SUPPRESS_COOLDOWN');
      expect(bounced.shouldNotify).toBe(false);

      const escalated = sm.processEvaluation(
        'ep-2',
        buildMockReport(tEscalate, 'PAGE_FAST'),
        tEscalate
      );
      expect(escalated.action).toBe('DISPATCH_ESCALATION');
      expect(escalated.shouldNotify).toBe(true);
      expect(escalated.nextState.phase).toBe('FIRING');
    });

    it('permite un nuevo disparo limpio una vez expirada la ventana de cooldown', () => {
      const sm = new SloAlertStateMachine({ cooldownMinutes: 10 });
      const t0 = new Date('2026-10-20T12:00:00Z');
      const tResolve = new Date('2026-10-20T12:05:00Z');
      const tAfterCooldown = new Date('2026-10-20T12:16:00Z'); // +11m (> 10m cooldown)

      sm.processEvaluation('ep-3', buildMockReport(t0, 'PAGE_SLOW'), t0);
      sm.processEvaluation('ep-3', buildMockReport(tResolve, null), tResolve);

      const refired = sm.processEvaluation(
        'ep-3',
        buildMockReport(tAfterCooldown, 'PAGE_SLOW'),
        tAfterCooldown
      );
      expect(refired.action).toBe('DISPATCH_FIRING');
      expect(refired.shouldNotify).toBe(true);
    });
  });
});
