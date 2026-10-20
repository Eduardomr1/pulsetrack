import { IEndpointRepository } from '../../domain/ports/endpoint.repository';
import { IHealthCheckRepository } from '../../domain/ports/health-check.repository';
import {
  ISloAlertDispatcher,
  SloBurnNotificationEventType,
} from '../../domain/ports/slo-alert-dispatcher.port';
import { BurnRatePolicyVo } from '../../domain/value-objects/burn-rate-window.vo';
import {
  MultiWindowBurnRateEvaluator,
  MultiWindowBurnReport,
} from '../../domain/services/multi-window-burn-rate.service';
import {
  SloAlertStateMachine,
  SloAlertTransitionDecision,
} from '../../domain/services/slo-alert-deduplicator.service';

export interface EvaluateEndpointSloBurnCommand {
  endpointId: string;
  targetSloPercentage?: number;
  complianceDays?: number;
  evaluationTime?: Date;
  minSamplesPerShortWindow?: number;
}

export interface EndpointSloBurnEvaluationResult {
  readonly endpointId: string;
  readonly endpointName: string;
  readonly targetUrl: string;
  readonly samplesEvaluated: number;
  readonly burnReport: MultiWindowBurnReport;
  readonly alertDecision: SloAlertTransitionDecision;
  readonly dispatchedNotification: boolean;
}

/**
 * Caso de Uso de Aplicación que orquesta la evaluación Multi-Window Multi-Burn-Rate
 * de un endpoint contra su historial de series de tiempo y despacha alertas deduplicadas.
 */
export class EvaluateEndpointSloBurnUseCase {
  constructor(
    private readonly endpointRepo: IEndpointRepository,
    private readonly healthCheckRepo: IHealthCheckRepository,
    private readonly burnEvaluator: MultiWindowBurnRateEvaluator = new MultiWindowBurnRateEvaluator(),
    private readonly alertStateMachine: SloAlertStateMachine = new SloAlertStateMachine(),
    private readonly alertDispatcher?: ISloAlertDispatcher
  ) {}

  public async execute(
    command: EvaluateEndpointSloBurnCommand
  ): Promise<EndpointSloBurnEvaluationResult> {
    const endpoint = await this.endpointRepo.findById(command.endpointId);
    if (!endpoint) {
      throw new Error(`Endpoint no encontrado: ${command.endpointId}`);
    }

    const evaluationTime = command.evaluationTime ?? new Date();
    const policy = BurnRatePolicyVo.googleSreDefaults(
      command.targetSloPercentage ?? 99.9,
      command.complianceDays ?? 30
    );

    const lookbackMs = policy.getMaxLookbackMinutes() * 60 * 1000;
    const from = new Date(evaluationTime.getTime() - lookbackMs);

    const historyChecks = await this.healthCheckRepo.findHistory({
      endpointId: endpoint.id,
      from,
      to: evaluationTime,
    });

    const samples = MultiWindowBurnRateEvaluator.fromHealthChecks(historyChecks);
    const burnReport = this.burnEvaluator.evaluate(samples, {
      policy,
      evaluationTime,
      minSamplesPerShortWindow: command.minSamplesPerShortWindow,
    });

    const alertDecision = this.alertStateMachine.processEvaluation(
      endpoint.id,
      burnReport,
      evaluationTime
    );

    let dispatchedNotification = false;

    if (alertDecision.shouldNotify && this.alertDispatcher) {
      const eventType = this.mapActionToEventType(alertDecision.action);
      if (eventType) {
        await this.alertDispatcher.dispatchSloAlert({
          endpoint,
          eventType,
          burnReport,
          alertState: alertDecision.nextState,
          reason: alertDecision.reason,
          occurredAt: evaluationTime,
        });
        dispatchedNotification = true;
      }
    }

    return {
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      targetUrl: endpoint.url.value,
      samplesEvaluated: samples.length,
      burnReport,
      alertDecision,
      dispatchedNotification,
    };
  }

  private mapActionToEventType(
    action: SloAlertTransitionDecision['action']
  ): SloBurnNotificationEventType | null {
    switch (action) {
      case 'DISPATCH_FIRING':
        return 'SLO_BURN_FIRING';
      case 'DISPATCH_ESCALATION':
        return 'SLO_BURN_ESCALATED';
      case 'DISPATCH_RESOLVED':
        return 'SLO_BURN_RESOLVED';
      default:
        return null;
    }
  }
}
