import { Endpoint } from '../entities/endpoint.entity';
import { MultiWindowBurnReport } from '../services/multi-window-burn-rate.service';
import { EndpointSloAlertState } from '../services/slo-alert-deduplicator.service';

export type SloBurnNotificationEventType =
  | 'SLO_BURN_FIRING'
  | 'SLO_BURN_ESCALATED'
  | 'SLO_BURN_RESOLVED';

export interface SloBurnAlertPayload {
  readonly endpoint: Endpoint;
  readonly eventType: SloBurnNotificationEventType;
  readonly burnReport: MultiWindowBurnReport;
  readonly alertState: EndpointSloAlertState;
  readonly reason: string;
  readonly occurredAt: Date;
}

export interface ISloAlertDispatcher {
  dispatchSloAlert(payload: SloBurnAlertPayload): Promise<void>;
}
