import { MultiWindowBurnReport } from './multi-window-burn-rate.service';
import {
  BurnRatePolicyVo,
  SloAlertSeverity,
  SloBurnTier,
} from '../value-objects/burn-rate-window.vo';

export type SloAlertLifecyclePhase = 'IDLE' | 'FIRING' | 'COOLDOWN';

export type SloAlertDispatchAction =
  | 'NO_OP'
  | 'DISPATCH_FIRING'
  | 'DISPATCH_ESCALATION'
  | 'DISPATCH_RESOLVED'
  | 'SUPPRESS_DUPLICATE'
  | 'SUPPRESS_COOLDOWN';

export interface SloAlertDeduplicatorConfig {
  cooldownMinutes: number;
  reNotifyIntervalMinutes?: number;
}

export interface EndpointSloAlertState {
  readonly endpointId: string;
  readonly phase: SloAlertLifecyclePhase;
  readonly activeTier: SloBurnTier | null;
  readonly peakTierInEpisode: SloBurnTier | null;
  readonly activeSeverity: SloAlertSeverity | null;
  readonly fingerprint: string | null;
  readonly firstFiredAt: Date | null;
  readonly lastDispatchedAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly cooldownUntil: Date | null;
  readonly suppressedCount: number;
}

export interface SloAlertTransitionDecision {
  readonly endpointId: string;
  readonly action: SloAlertDispatchAction;
  readonly shouldNotify: boolean;
  readonly previousPhase: SloAlertLifecyclePhase;
  readonly nextState: EndpointSloAlertState;
  readonly reason: string;
}

export const DEFAULT_SLO_DEDUPLICATOR_CONFIG: SloAlertDeduplicatorConfig = {
  cooldownMinutes: 15,
};

/**
 * Máquina de estados de deduplicación, escalamiento y cooldown para alertas de Burn-Rate SLO.
 * Previene fatiga de alertas (alert fatigue) suprimiendo duplicados, aplicando histéresis
 * post-resolución y permitiendo bypass inmediato ante escalamientos de severidad.
 */
export class SloAlertStateMachine {
  private readonly states: Map<string, EndpointSloAlertState> = new Map();
  private readonly config: SloAlertDeduplicatorConfig;

  constructor(config?: Partial<SloAlertDeduplicatorConfig>) {
    this.config = {
      ...DEFAULT_SLO_DEDUPLICATOR_CONFIG,
      ...config,
      cooldownMinutes: Math.max(0, config?.cooldownMinutes ?? DEFAULT_SLO_DEDUPLICATOR_CONFIG.cooldownMinutes),
    };
  }

  public static createInitialState(endpointId: string): EndpointSloAlertState {
    return {
      endpointId,
      phase: 'IDLE',
      activeTier: null,
      peakTierInEpisode: null,
      activeSeverity: null,
      fingerprint: null,
      firstFiredAt: null,
      lastDispatchedAt: null,
      resolvedAt: null,
      cooldownUntil: null,
      suppressedCount: 0,
    };
  }

  public static buildFingerprint(endpointId: string, tier: SloBurnTier): string {
    return `slo-burn:${endpointId}:${tier}`;
  }

  public processEvaluation(
    endpointId: string,
    report: MultiWindowBurnReport,
    now: Date = new Date(report.evaluatedAt)
  ): SloAlertTransitionDecision {
    const current = this.states.get(endpointId) ?? SloAlertStateMachine.createInitialState(endpointId);
    const decision = SloAlertStateMachine.computeTransition(current, report, this.config, now);
    this.states.set(endpointId, decision.nextState);
    return decision;
  }

  public getState(endpointId: string): EndpointSloAlertState | undefined {
    return this.states.get(endpointId);
  }

  public resetEndpoint(endpointId: string): void {
    this.states.delete(endpointId);
  }

  public clearAll(): void {
    this.states.clear();
  }

  public static computeTransition(
    current: EndpointSloAlertState,
    report: MultiWindowBurnReport,
    config: SloAlertDeduplicatorConfig = DEFAULT_SLO_DEDUPLICATOR_CONFIG,
    now: Date = new Date()
  ): SloAlertTransitionDecision {
    const nowMs = now.getTime();
    const cooldownMs = Math.max(0, config.cooldownMinutes) * 60 * 1000;

    // Normalize expired cooldown back to IDLE baseline before evaluating
    const isCooldownActive =
      current.phase === 'COOLDOWN' &&
      current.cooldownUntil !== null &&
      nowMs < current.cooldownUntil.getTime();

    const effectivePhase: SloAlertLifecyclePhase =
      current.phase === 'COOLDOWN' && !isCooldownActive ? 'IDLE' : current.phase;

    if (!report.isFiring || !report.highestFiringTier || !report.highestSeverity) {
      if (effectivePhase === 'FIRING') {
        const cooldownUntil = cooldownMs > 0 ? new Date(nowMs + cooldownMs) : null;
        const nextPhase: SloAlertLifecyclePhase = cooldownUntil ? 'COOLDOWN' : 'IDLE';
        const nextState: EndpointSloAlertState = {
          ...current,
          phase: nextPhase,
          activeTier: null,
          activeSeverity: null,
          resolvedAt: now,
          lastDispatchedAt: now,
          cooldownUntil,
        };

        return {
          endpointId: current.endpointId,
          action: 'DISPATCH_RESOLVED',
          shouldNotify: true,
          previousPhase: current.phase,
          nextState,
          reason: `Burn-rate normalizado debajo del umbral SLO. Iniciando ventana de cooldown de ${config.cooldownMinutes}m.`,
        };
      }

      if (effectivePhase === 'IDLE' && current.phase === 'COOLDOWN') {
        const cleanIdle = SloAlertStateMachine.createInitialState(current.endpointId);
        return {
          endpointId: current.endpointId,
          action: 'NO_OP',
          shouldNotify: false,
          previousPhase: current.phase,
          nextState: cleanIdle,
          reason: 'Ventana de cooldown expirada sin nuevas violaciones de burn-rate.',
        };
      }

      return {
        endpointId: current.endpointId,
        action: 'NO_OP',
        shouldNotify: false,
        previousPhase: current.phase,
        nextState: current,
        reason: 'Sin violaciones activas de burn-rate SLO.',
      };
    }

    // Report IS firing
    const incomingTier = report.highestFiringTier;
    const incomingSeverity = report.highestSeverity;
    const incomingFingerprint = SloAlertStateMachine.buildFingerprint(current.endpointId, incomingTier);

    if (effectivePhase === 'IDLE') {
      const nextState: EndpointSloAlertState = {
        endpointId: current.endpointId,
        phase: 'FIRING',
        activeTier: incomingTier,
        peakTierInEpisode: incomingTier,
        activeSeverity: incomingSeverity,
        fingerprint: incomingFingerprint,
        firstFiredAt: now,
        lastDispatchedAt: now,
        resolvedAt: null,
        cooldownUntil: null,
        suppressedCount: 0,
      };

      return {
        endpointId: current.endpointId,
        action: 'DISPATCH_FIRING',
        shouldNotify: true,
        previousPhase: current.phase,
        nextState,
        reason: `Disparo inicial de alerta SLO [${incomingTier}] (${incomingSeverity}).`,
      };
    }

    if (effectivePhase === 'COOLDOWN') {
      const baselinePeak = current.peakTierInEpisode;
      const isEscalationOverCooldown =
        baselinePeak !== null &&
        BurnRatePolicyVo.compareTierPriority(incomingTier, baselinePeak) > 0;

      if (isEscalationOverCooldown) {
        const nextState: EndpointSloAlertState = {
          endpointId: current.endpointId,
          phase: 'FIRING',
          activeTier: incomingTier,
          peakTierInEpisode: incomingTier,
          activeSeverity: incomingSeverity,
          fingerprint: incomingFingerprint,
          firstFiredAt: current.firstFiredAt ?? now,
          lastDispatchedAt: now,
          resolvedAt: null,
          cooldownUntil: null,
          suppressedCount: current.suppressedCount,
        };

        return {
          endpointId: current.endpointId,
          action: 'DISPATCH_ESCALATION',
          shouldNotify: true,
          previousPhase: current.phase,
          nextState,
          reason: `Escalamiento crítico durante cooldown (${baselinePeak} -> ${incomingTier}): omitiendo supresión.`,
        };
      }

      const nextState: EndpointSloAlertState = {
        ...current,
        suppressedCount: current.suppressedCount + 1,
      };

      return {
        endpointId: current.endpointId,
        action: 'SUPPRESS_COOLDOWN',
        shouldNotify: false,
        previousPhase: current.phase,
        nextState,
        reason: `Alerta [${incomingTier}] suprimida por ventana activa de cooldown hasta ${current.cooldownUntil?.toISOString() ?? 'N/A'}.`,
      };
    }

    // effectivePhase === 'FIRING'
    const referenceTier = current.peakTierInEpisode ?? current.activeTier;
    const isHigherSeverityTier =
      referenceTier !== null &&
      BurnRatePolicyVo.compareTierPriority(incomingTier, referenceTier) > 0;

    if (isHigherSeverityTier) {
      const nextState: EndpointSloAlertState = {
        ...current,
        phase: 'FIRING',
        activeTier: incomingTier,
        peakTierInEpisode: incomingTier,
        activeSeverity: incomingSeverity,
        fingerprint: incomingFingerprint,
        lastDispatchedAt: now,
      };

      return {
        endpointId: current.endpointId,
        action: 'DISPATCH_ESCALATION',
        shouldNotify: true,
        previousPhase: current.phase,
        nextState,
        reason: `Escalamiento de severidad SLO (${referenceTier} -> ${incomingTier}).`,
      };
    }

    // Optional periodic re-notification for long-running unmitigated incidents
    const reNotifyMs =
      config.reNotifyIntervalMinutes && config.reNotifyIntervalMinutes > 0
        ? config.reNotifyIntervalMinutes * 60 * 1000
        : 0;

    if (
      reNotifyMs > 0 &&
      current.lastDispatchedAt !== null &&
      nowMs - current.lastDispatchedAt.getTime() >= reNotifyMs
    ) {
      const nextState: EndpointSloAlertState = {
        ...current,
        activeTier: incomingTier,
        activeSeverity: incomingSeverity,
        fingerprint: incomingFingerprint,
        lastDispatchedAt: now,
      };

      return {
        endpointId: current.endpointId,
        action: 'DISPATCH_FIRING',
        shouldNotify: true,
        previousPhase: current.phase,
        nextState,
        reason: `Re-notificación periódica de alerta SLO [${incomingTier}] persistente.`,
      };
    }

    const nextState: EndpointSloAlertState = {
      ...current,
      activeTier: incomingTier,
      activeSeverity: incomingSeverity,
      suppressedCount: current.suppressedCount + 1,
    };

    return {
      endpointId: current.endpointId,
      action: 'SUPPRESS_DUPLICATE',
      shouldNotify: false,
      previousPhase: current.phase,
      nextState,
      reason: `Alerta SLO [${incomingTier}] duplicada dentro del episodio activo; suprimida.`,
    };
  }
}
