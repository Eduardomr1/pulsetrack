import crypto from 'node:crypto';
import { IAlertNotifier, AlertNotificationPayload } from '../../core/domain/ports/notifier.port';
import { WebhookConfig } from '../../core/domain/entities/alert-channel.entity';

export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  errorMessage?: string;
  attempts: number;
}

export class WebhookNotifierAgent implements IAlertNotifier {
  constructor(private readonly config: WebhookConfig) {}

  public async notify(payload: AlertNotificationPayload): Promise<void> {
    await this.deliverWithRetry(payload);
  }

  public async deliverWithRetry(
    payload: AlertNotificationPayload,
    maxRetries: number = 3
  ): Promise<WebhookDeliveryResult> {
    const { endpoint, result, incident, type } = payload;

    const bodyData = {
      event: `endpoint.${type.toLowerCase()}`,
      timestamp: new Date().toISOString(),
      endpoint: {
        id: endpoint.id,
        name: endpoint.name,
        url: endpoint.url.value,
        method: endpoint.method.value,
        tags: endpoint.tags,
      },
      telemetry: {
        status: result.status.value,
        statusCode: result.statusCode,
        statusText: result.statusText,
        region: result.region,
        latency: result.latency.toJSON(),
        sslInfo: result.sslInfo,
        failedAssertions: result.failedAssertions,
      },
      incident: incident
        ? {
            id: incident.id,
            status: incident.status,
            severity: incident.severity,
            startedAt: incident.startedAt.toISOString(),
            consecutiveFailures: incident.consecutiveFailures,
            summary: incident.summary,
          }
        : null,
    };

    const rawBody = JSON.stringify(bodyData);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'PulseTrack-WebhookAgent/1.0',
      ...this.config.headers,
    };

    // Calculate HMAC-SHA256 signature if secretKey is provided
    if (this.config.secretKey) {
      const hmac = crypto.createHmac('sha256', this.config.secretKey);
      hmac.update(rawBody);
      headers['X-PulseTrack-Signature'] = `sha256=${hmac.digest('hex')}`;
    }

    let lastError: string | undefined;
    let lastStatusCode: number | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 6000);

        const response = await fetch(this.config.webhookUrl, {
          method: 'POST',
          headers,
          body: rawBody,
          signal: controller.signal,
        });

        clearTimeout(timeout);
        lastStatusCode = response.status;

        if (response.ok) {
          return { success: true, statusCode: response.status, attempts: attempt };
        }

        lastError = `HTTP ${response.status} ${response.statusText}`;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : 'Error desconocido al enviar webhook';
      }

      // Exponential backoff before next retry
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 200 + Math.random() * 100;
        await new Promise((res) => setTimeout(res, delay));
      }
    }

    return {
      success: false,
      statusCode: lastStatusCode,
      errorMessage: lastError,
      attempts: maxRetries,
    };
  }
}
