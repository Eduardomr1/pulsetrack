import { Endpoint } from '../entities/endpoint.entity';
import { Incident } from '../entities/incident.entity';
import { HealthCheckResult } from '../entities/health-check.entity';

export interface AlertNotificationPayload {
  endpoint: Endpoint;
  result: HealthCheckResult;
  incident?: Incident | null;
  type: 'DOWN' | 'DEGRADED' | 'RECOVERED';
}

export interface IAlertNotifier {
  notify(payload: AlertNotificationPayload): Promise<void>;
}
