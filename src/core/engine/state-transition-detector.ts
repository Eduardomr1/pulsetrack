import { HealthStatusVo } from '../domain/value-objects/health-status.vo';
import { HealthCheckResult } from '../domain/entities/health-check.entity';

export type EndpointState = 'OPERATIONAL' | 'DEGRADED' | 'DOWN';

export interface StateTransitionConfig {
  /**
   * Número de fallos consecutivos requeridos para transicionar a DOWN.
   * Evita falsos positivos por problemas de red transitorios (flapping).
   * Por defecto: 3.
   */
  consecutiveFailuresThreshold: number;

  /**
   * Número de muestras con lentitud o aserciones no críticas para transicionar a DEGRADED.
   * Por defecto: 2.
   */
  consecutiveDegradedThreshold: number;

  /**
   * Número de chequeos exitosos consecutivos requeridos para recuperar el estado a OPERATIONAL.
   * Por defecto: 2.
   */
  consecutiveSuccessThreshold: number;

  /**
   * Umbral opcional de latencia total (en ms) a partir del cual una respuesta se considera DEGRADED.
   */
  degradedLatencyThresholdMs?: number;
}

export const DEFAULT_STATE_TRANSITION_CONFIG: StateTransitionConfig = {
  consecutiveFailuresThreshold: 3,
  consecutiveDegradedThreshold: 2,
  consecutiveSuccessThreshold: 2,
};

export interface SampleEvaluationInput {
  status?: EndpointState | HealthStatusVo | string;
  statusCode?: number | null;
  latencyMs?: number;
  errorMessage?: string | null;
  failedAssertions?: readonly string[] | string[];
}

export interface SampleHistoryItem {
  timestamp: Date;
  status: EndpointState;
  latencyMs: number;
  statusCode: number | null;
  errorMessage: string | null;
}

export interface StateTransitionEvent {
  endpointId: string;
  previousState: EndpointState;
  newState: EndpointState;
  timestamp: Date;
  consecutiveCount: number;
  reason: string;
  sample: {
    status: EndpointState;
    statusCode: number | null;
    latencyMs: number;
    errorMessage: string | null;
  };
}

export interface StateEvaluationResult {
  endpointId: string;
  previousState: EndpointState;
  currentState: EndpointState;
  sampleStatus: EndpointState;
  hasTransitioned: boolean;
  consecutiveFailures: number;
  consecutiveDegraded: number;
  consecutiveSuccesses: number;
  transitionEvent: StateTransitionEvent | null;
  summary: string;
}

export interface EndpointHealthContext {
  endpointId: string;
  currentState: EndpointState;
  consecutiveFailures: number;
  consecutiveDegraded: number;
  consecutiveSuccesses: number;
  lastSampleStatus: EndpointState | null;
  lastTransitionAt: Date;
  lastCheckedAt: Date;
  history: SampleHistoryItem[];
}

export type StateTransitionListener = (event: StateTransitionEvent) => void;

/**
 * State Transition Detector & Anti-Flapping Engine for PulseTrack.
 * Controls state transitions between OPERATIONAL, DEGRADED, and DOWN using configurable consecutive failure/success thresholds.
 */
export class StateTransitionDetector {
  private readonly contexts: Map<string, EndpointHealthContext> = new Map();
  private readonly endpointConfigs: Map<string, Partial<StateTransitionConfig>> = new Map();
  private readonly listeners: Set<StateTransitionListener> = new Set();
  private readonly defaultConfig: StateTransitionConfig;

  constructor(defaultConfig?: Partial<StateTransitionConfig>) {
    this.defaultConfig = {
      ...DEFAULT_STATE_TRANSITION_CONFIG,
      ...defaultConfig,
    };
  }

  /**
   * Registers custom threshold configuration for a specific endpoint.
   */
  public registerEndpointConfig(endpointId: string, config: Partial<StateTransitionConfig>): void {
    this.endpointConfigs.set(endpointId, config);
  }

  /**
   * Retrieves the effective configuration for an endpoint.
   */
  public getEndpointConfig(endpointId: string, override?: Partial<StateTransitionConfig>): StateTransitionConfig {
    const custom = this.endpointConfigs.get(endpointId) ?? {};
    return {
      ...this.defaultConfig,
      ...custom,
      ...override,
    };
  }

  /**
   * Subscribes a callback to listen for state transitions.
   * Returns an unsubscribe function.
   */
  public onTransition(listener: StateTransitionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Evaluates and classifies a single probe sample into an instantaneous EndpointState.
   */
  public classifySample(
    sample: SampleEvaluationInput | HealthCheckResult,
    config: StateTransitionConfig
  ): EndpointState {
    if (sample instanceof HealthCheckResult) {
      if (sample.status.isDown()) return 'DOWN';
      if (sample.status.isDegraded()) return 'DEGRADED';
      if (config.degradedLatencyThresholdMs && sample.latency.totalMs > config.degradedLatencyThresholdMs) {
        return 'DEGRADED';
      }
      return 'OPERATIONAL';
    }

    // Network disconnection, timeouts, or unhandled errors -> DOWN
    if (sample.statusCode === null || sample.statusCode === undefined) {
      if (sample.errorMessage || sample.status === 'DOWN') {
        return 'DOWN';
      }
    }

    if (typeof sample.statusCode === 'number' && sample.statusCode >= 500) {
      return 'DOWN';
    }

    if (sample.status) {
      const statusStr = typeof sample.status === 'string'
        ? sample.status.toUpperCase()
        : sample.status.value.toUpperCase();

      if (statusStr === 'DOWN') return 'DOWN';
      if (statusStr === 'DEGRADED') return 'DEGRADED';
    }

    if (sample.failedAssertions && sample.failedAssertions.length > 0) {
      const hasCriticalFailure = sample.failedAssertions.some((f) =>
        f.toLowerCase().includes('código de estado') ||
        f.toLowerCase().includes('status code') ||
        f.toLowerCase().includes('conexión') ||
        f.toLowerCase().includes('sin respuesta')
      );
      return hasCriticalFailure ? 'DOWN' : 'DEGRADED';
    }

    if (config.degradedLatencyThresholdMs && sample.latencyMs && sample.latencyMs > config.degradedLatencyThresholdMs) {
      return 'DEGRADED';
    }

    return 'OPERATIONAL';
  }

  /**
   * Processes a probe sample against the endpoint's state history, evaluates consecutive counters,
   * and triggers transitions when thresholds are met.
   */
  public processSample(
    endpointId: string,
    sample: SampleEvaluationInput | HealthCheckResult,
    configOverride?: Partial<StateTransitionConfig>
  ): StateEvaluationResult {
    const config = this.getEndpointConfig(endpointId, configOverride);
    const context = this.getOrCreateContext(endpointId);
    const previousState = context.currentState;
    const sampleStatus = this.classifySample(sample, config);

    const now = new Date();
    context.lastCheckedAt = now;
    context.lastSampleStatus = sampleStatus;

    const sampleLatencyMs = sample instanceof HealthCheckResult
      ? sample.latency.totalMs
      : (sample.latencyMs ?? 0);

    const sampleStatusCode = sample instanceof HealthCheckResult
      ? sample.statusCode
      : (sample.statusCode ?? null);

    const sampleErrorMessage = sample instanceof HealthCheckResult
      ? sample.errorMessage
      : (sample.errorMessage ?? null);

    context.history.push({
      timestamp: now,
      status: sampleStatus,
      latencyMs: sampleLatencyMs,
      statusCode: sampleStatusCode,
      errorMessage: sampleErrorMessage,
    });

    if (context.history.length > 50) {
      context.history.shift();
    }

    let hasTransitioned = false;
    let transitionEvent: StateTransitionEvent | null = null;
    let summary: string;

    if (sampleStatus === 'DOWN') {
      context.consecutiveFailures += 1;
      context.consecutiveDegraded = 0;
      context.consecutiveSuccesses = 0;

      if (context.currentState === 'DOWN') {
        summary = `El endpoint continúa en DOWN (${context.consecutiveFailures} fallos consecutivos acumulados).`;
      } else if (context.consecutiveFailures >= config.consecutiveFailuresThreshold) {
        // Threshold reached -> Transition to DOWN
        hasTransitioned = true;
        const fromState = context.currentState;
        context.currentState = 'DOWN';
        context.lastTransitionAt = now;

        const reason = `Confirmada caída del servicio tras ${context.consecutiveFailures} fallos consecutivos (umbral: ${config.consecutiveFailuresThreshold}).`;
        transitionEvent = {
          endpointId,
          previousState: fromState,
          newState: 'DOWN',
          timestamp: now,
          consecutiveCount: context.consecutiveFailures,
          reason,
          sample: {
            status: sampleStatus,
            statusCode: sampleStatusCode,
            latencyMs: sampleLatencyMs,
            errorMessage: sampleErrorMessage,
          },
        };
        summary = reason;
        this.emitTransition(transitionEvent);
      } else {
        // Anti-flapping: suppress false positive transition
        summary = `Fallo transitorio detectado (${context.consecutiveFailures}/${config.consecutiveFailuresThreshold}). Estado mantenido en ${context.currentState} para evitar falsos positivos.`;
      }
    } else if (sampleStatus === 'DEGRADED') {
      context.consecutiveDegraded += 1;
      context.consecutiveFailures = 0;
      context.consecutiveSuccesses = 0;

      if (context.currentState === 'DEGRADED') {
        summary = `El endpoint continúa en estado DEGRADED (${context.consecutiveDegraded} chequeos degradados acumulados).`;
      } else if (context.currentState === 'OPERATIONAL') {
        if (context.consecutiveDegraded >= config.consecutiveDegradedThreshold) {
          hasTransitioned = true;
          const fromState = context.currentState;
          context.currentState = 'DEGRADED';
          context.lastTransitionAt = now;

          const reason = `Rendimiento degradado persistente tras ${context.consecutiveDegraded} chequeos (umbral: ${config.consecutiveDegradedThreshold}).`;
          transitionEvent = {
            endpointId,
            previousState: fromState,
            newState: 'DEGRADED',
            timestamp: now,
            consecutiveCount: context.consecutiveDegraded,
            reason,
            sample: {
              status: sampleStatus,
              statusCode: sampleStatusCode,
              latencyMs: sampleLatencyMs,
              errorMessage: sampleErrorMessage,
            },
          };
          summary = reason;
          this.emitTransition(transitionEvent);
        } else {
          summary = `Muestra degradada aislada (${context.consecutiveDegraded}/${config.consecutiveDegradedThreshold}). Estado mantenido en OPERATIONAL.`;
        }
      } else {
        // Currently DOWN: partial recovery to DEGRADED
        if (context.consecutiveDegraded >= config.consecutiveDegradedThreshold) {
          hasTransitioned = true;
          const fromState = context.currentState;
          context.currentState = 'DEGRADED';
          context.lastTransitionAt = now;

          const reason = `Servicio responde nuevamente pero en estado degradado tras ${context.consecutiveDegraded} chequeos.`;
          transitionEvent = {
            endpointId,
            previousState: fromState,
            newState: 'DEGRADED',
            timestamp: now,
            consecutiveCount: context.consecutiveDegraded,
            reason,
            sample: {
              status: sampleStatus,
              statusCode: sampleStatusCode,
              latencyMs: sampleLatencyMs,
              errorMessage: sampleErrorMessage,
            },
          };
          summary = reason;
          this.emitTransition(transitionEvent);
        } else {
          summary = `Respuesta recibida pero degradada mientras estaba DOWN. Manteniendo DOWN hasta confirmar estabilidad.`;
        }
      }
    } else {
      // OPERATIONAL
      context.consecutiveSuccesses += 1;
      context.consecutiveFailures = 0;
      context.consecutiveDegraded = 0;

      if (context.currentState === 'OPERATIONAL') {
        summary = 'Endpoint operando con normalidad (OPERATIONAL).';
      } else if (context.consecutiveSuccesses >= config.consecutiveSuccessThreshold) {
        // Confirmed recovery
        hasTransitioned = true;
        const fromState = context.currentState;
        context.currentState = 'OPERATIONAL';
        context.lastTransitionAt = now;

        const reason = `Recuperación confirmada tras ${context.consecutiveSuccesses} chequeos exitosos consecutivos (umbral: ${config.consecutiveSuccessThreshold}).`;
        transitionEvent = {
          endpointId,
          previousState: fromState,
          newState: 'OPERATIONAL',
          timestamp: now,
          consecutiveCount: context.consecutiveSuccesses,
          reason,
          sample: {
            status: sampleStatus,
            statusCode: sampleStatusCode,
            latencyMs: sampleLatencyMs,
            errorMessage: sampleErrorMessage,
          },
        };
        summary = reason;
        this.emitTransition(transitionEvent);
      } else {
        summary = `Chequeo exitoso (${context.consecutiveSuccesses}/${config.consecutiveSuccessThreshold}). Manteniendo ${context.currentState} hasta confirmar recuperación completa.`;
      }
    }

    return {
      endpointId,
      previousState,
      currentState: context.currentState,
      sampleStatus,
      hasTransitioned,
      consecutiveFailures: context.consecutiveFailures,
      consecutiveDegraded: context.consecutiveDegraded,
      consecutiveSuccesses: context.consecutiveSuccesses,
      transitionEvent,
      summary,
    };
  }

  /**
   * Retrieves current health context for an endpoint.
   */
  public getContext(endpointId: string): EndpointHealthContext | undefined {
    return this.contexts.get(endpointId);
  }

  /**
   * Retrieves or initializes health context for an endpoint.
   */
  public getOrCreateContext(endpointId: string, initialState: EndpointState = 'OPERATIONAL'): EndpointHealthContext {
    let ctx = this.contexts.get(endpointId);
    if (!ctx) {
      const now = new Date();
      ctx = {
        endpointId,
        currentState: initialState,
        consecutiveFailures: 0,
        consecutiveDegraded: 0,
        consecutiveSuccesses: 0,
        lastSampleStatus: null,
        lastTransitionAt: now,
        lastCheckedAt: now,
        history: [],
      };
      this.contexts.set(endpointId, ctx);
    }
    return ctx;
  }

  /**
   * Resets internal tracking context for a single endpoint.
   */
  public resetEndpoint(endpointId: string): void {
    this.contexts.delete(endpointId);
  }

  /**
   * Clears all stored endpoint health contexts.
   */
  public clear(): void {
    this.contexts.clear();
    this.endpointConfigs.clear();
  }

  /**
   * Returns a snapshot of all active endpoint health contexts.
   */
  public getAllContexts(): Map<string, EndpointHealthContext> {
    return new Map(this.contexts);
  }

  private emitTransition(event: StateTransitionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error(`[StateTransitionDetector] Error ejecutando listener de transición:`, err);
      }
    }
  }

  /**
   * Pure functional transition computation without mutating instance state.
   */
  public static computePureTransition(
    currentContext: EndpointHealthContext,
    sampleStatus: EndpointState,
    config: StateTransitionConfig,
    now: Date = new Date(),
    sampleDetails: { statusCode: number | null; latencyMs: number; errorMessage: string | null } = {
      statusCode: null,
      latencyMs: 0,
      errorMessage: null,
    }
  ): {
    nextContext: EndpointHealthContext;
    transitionResult: StateEvaluationResult;
  } {
    const nextContext: EndpointHealthContext = {
      ...currentContext,
      history: [...currentContext.history],
      lastCheckedAt: now,
      lastSampleStatus: sampleStatus,
    };

    let hasTransitioned = false;
    let transitionEvent: StateTransitionEvent | null = null;
    let summary: string;
    const previousState = currentContext.currentState;

    if (sampleStatus === 'DOWN') {
      nextContext.consecutiveFailures = currentContext.consecutiveFailures + 1;
      nextContext.consecutiveDegraded = 0;
      nextContext.consecutiveSuccesses = 0;

      if (currentContext.currentState === 'DOWN') {
        summary = `Continuidad en DOWN.`;
      } else if (nextContext.consecutiveFailures >= config.consecutiveFailuresThreshold) {
        hasTransitioned = true;
        nextContext.currentState = 'DOWN';
        nextContext.lastTransitionAt = now;
        transitionEvent = {
          endpointId: currentContext.endpointId,
          previousState,
          newState: 'DOWN',
          timestamp: now,
          consecutiveCount: nextContext.consecutiveFailures,
          reason: `Umbral de fallos consecutivos alcanzado (${nextContext.consecutiveFailures}/${config.consecutiveFailuresThreshold}).`,
          sample: {
            status: sampleStatus,
            statusCode: sampleDetails.statusCode,
            latencyMs: sampleDetails.latencyMs,
            errorMessage: sampleDetails.errorMessage,
          },
        };
        summary = transitionEvent.reason;
      } else {
        summary = `Fallo transitorio no crítico (${nextContext.consecutiveFailures}/${config.consecutiveFailuresThreshold}).`;
      }
    } else if (sampleStatus === 'DEGRADED') {
      nextContext.consecutiveDegraded = currentContext.consecutiveDegraded + 1;
      nextContext.consecutiveFailures = 0;
      nextContext.consecutiveSuccesses = 0;

      if (currentContext.currentState === 'DEGRADED') {
        summary = `Continuidad en DEGRADED.`;
      } else if (nextContext.consecutiveDegraded >= config.consecutiveDegradedThreshold) {
        hasTransitioned = true;
        nextContext.currentState = 'DEGRADED';
        nextContext.lastTransitionAt = now;
        transitionEvent = {
          endpointId: currentContext.endpointId,
          previousState,
          newState: 'DEGRADED',
          timestamp: now,
          consecutiveCount: nextContext.consecutiveDegraded,
          reason: `Umbral degradado alcanzado (${nextContext.consecutiveDegraded}/${config.consecutiveDegradedThreshold}).`,
          sample: {
            status: sampleStatus,
            statusCode: sampleDetails.statusCode,
            latencyMs: sampleDetails.latencyMs,
            errorMessage: sampleDetails.errorMessage,
          },
        };
        summary = transitionEvent.reason;
      } else {
        summary = `Muestra degradada aislada (${nextContext.consecutiveDegraded}/${config.consecutiveDegradedThreshold}).`;
      }
    } else {
      nextContext.consecutiveSuccesses = currentContext.consecutiveSuccesses + 1;
      nextContext.consecutiveFailures = 0;
      nextContext.consecutiveDegraded = 0;

      if (currentContext.currentState === 'OPERATIONAL') {
        summary = `Continuidad en OPERATIONAL.`;
      } else if (nextContext.consecutiveSuccesses >= config.consecutiveSuccessThreshold) {
        hasTransitioned = true;
        nextContext.currentState = 'OPERATIONAL';
        nextContext.lastTransitionAt = now;
        transitionEvent = {
          endpointId: currentContext.endpointId,
          previousState,
          newState: 'OPERATIONAL',
          timestamp: now,
          consecutiveCount: nextContext.consecutiveSuccesses,
          reason: `Recuperación confirmada (${nextContext.consecutiveSuccesses}/${config.consecutiveSuccessThreshold}).`,
          sample: {
            status: sampleStatus,
            statusCode: sampleDetails.statusCode,
            latencyMs: sampleDetails.latencyMs,
            errorMessage: sampleDetails.errorMessage,
          },
        };
        summary = transitionEvent.reason;
      } else {
        summary = `Chequeo exitoso (${nextContext.consecutiveSuccesses}/${config.consecutiveSuccessThreshold}).`;
      }
    }

    return {
      nextContext,
      transitionResult: {
        endpointId: currentContext.endpointId,
        previousState,
        currentState: nextContext.currentState,
        sampleStatus,
        hasTransitioned,
        consecutiveFailures: nextContext.consecutiveFailures,
        consecutiveDegraded: nextContext.consecutiveDegraded,
        consecutiveSuccesses: nextContext.consecutiveSuccesses,
        transitionEvent,
        summary,
      },
    };
  }
}
