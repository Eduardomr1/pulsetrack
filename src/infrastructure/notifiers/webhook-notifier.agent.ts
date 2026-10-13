import crypto from 'node:crypto';
import { IAlertNotifier, AlertNotificationPayload } from '../../core/domain/ports/notifier.port';
import { WebhookConfig } from '../../core/domain/entities/alert-channel.entity';
import {
  executeHttpDeliveryWithRetry,
  RetryOptions,
  WebhookDeliveryResult,
} from './retry.util';

export type { WebhookDeliveryResult };

export class WebhookNotifierAgent implements IAlertNotifier {
  constructor(private readonly config: WebhookConfig) {}

  public async notify(payload: AlertNotificationPayload): Promise<void> {
    await this.deliverWithRetry(payload);
  }

  /**
   * Builds the structured JSON webhook payload including full telemetry,
   * latency RED breakdown, assertions, and incident root cause/lifecycle.
   */
  public buildPayload(payload: AlertNotificationPayload) {
    const { endpoint, result, incident, type } = payload;

    return {
      event: `endpoint.${type.toLowerCase()}`,
      timestamp: new Date().toISOString(),
      endpoint: {
        id: endpoint.id,
        name: endpoint.name,
        url: endpoint.url.value,
        method: endpoint.method.value,
        intervalSeconds: endpoint.intervalSeconds,
        tags: endpoint.tags,
      },
      telemetry: {
        status: result.status.value,
        statusCode: result.statusCode,
        statusText: result.statusText,
        region: result.region,
        latency: {
          dnsLookupMs: result.latency.dnsLookupMs,
          tcpConnectMs: result.latency.tcpConnectMs,
          tlsHandshakeMs: result.latency.tlsHandshakeMs,
          ttfbMs: result.latency.ttfbMs,
          contentTransferMs: result.latency.contentTransferMs,
          totalMs: result.latency.totalMs,
        },
        sslInfo: result.sslInfo,
        failedAssertions: result.failedAssertions,
      },
      incident: incident
        ? {
            id: incident.id,
            status: incident.status,
            severity: incident.severity,
            startedAt: incident.startedAt.toISOString(),
            resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
            durationMinutes: incident.getDurationMinutes(),
            consecutiveFailures: incident.consecutiveFailures,
            summary: incident.summary,
            rootCause: incident.rootCause,
            timeline: incident.timeline,
          }
        : null,
    };
  }

  /**
   * Delivers the webhook payload with exponential retries and HMAC-SHA256 authentication.
   */
  public async deliverWithRetry(
    payload: AlertNotificationPayload,
    options?: RetryOptions | number
  ): Promise<WebhookDeliveryResult> {
    const bodyData = this.buildPayload(payload);
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

    const retryOpts: RetryOptions =
      typeof options === 'number'
        ? { maxRetries: options, timeoutMs: this.config.timeoutMs ?? 6000 }
        : {
            timeoutMs: this.config.timeoutMs ?? 6000,
            ...options,
          };

    return executeHttpDeliveryWithRetry(
      this.config.webhookUrl,
      {
        method: 'POST',
        headers,
        body: rawBody,
      },
      retryOpts
    );
  }
}
