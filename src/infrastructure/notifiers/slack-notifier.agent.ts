import { IAlertNotifier, AlertNotificationPayload } from '../../core/domain/ports/notifier.port';
import { SlackConfig } from '../../core/domain/entities/alert-channel.entity';
import {
  executeHttpDeliveryWithRetry,
  RetryOptions,
  SlackDeliveryResult,
} from './retry.util';

export type { SlackDeliveryResult };

export class SlackNotifierAgent implements IAlertNotifier {
  constructor(private readonly config: SlackConfig) {}

  public async notify(payload: AlertNotificationPayload): Promise<void> {
    await this.deliverWithRetry(payload);
  }

  public async deliver(payload: AlertNotificationPayload): Promise<SlackDeliveryResult> {
    return this.deliverWithRetry(payload);
  }

  /**
   * Builds the rich Slack Block Kit payload with outage details, status,
   * full RED socket telemetry breakdown, and incident lifecycle tracking.
   */
  public buildPayload(payload: AlertNotificationPayload) {
    const { endpoint, result, incident, type } = payload;

    const isDown = type === 'DOWN';
    const isDegraded = type === 'DEGRADED';

    const color = isDown ? '#EF4444' : isDegraded ? '#F59E0B' : '#10B981';
    const emoji = isDown ? '🚨' : isDegraded ? '⚠️' : '✅';
    const headline = isDown
      ? 'Caída de Servicio Detectada (DOWN)'
      : isDegraded
      ? 'Degradación de Rendimiento / SLA (DEGRADED)'
      : 'Servicio Recuperado (RECOVERED)';

    const mentionPrefix =
      isDown && this.config.mentionOnCritical ? '<!channel> ' : '';

    const blocks: unknown[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${emoji} PulseTrack: ${headline}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${mentionPrefix}*Endpoint:* <${endpoint.url.value}|${endpoint.name}>\n*Método:* \`${endpoint.method.value}\` | *Intervalo:* ${endpoint.intervalSeconds}s | *Tags:* ${endpoint.tags.join(', ') || 'none'}`,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Estado:* \`${result.status.value}\``,
          },
          {
            type: 'mrkdwn',
            text: `*Código HTTP:* \`${result.statusCode ?? 'N/A'}\` ${result.statusText ?? ''}`,
          },
          {
            type: 'mrkdwn',
            text: `*Latencia Total:* \`${result.latency.totalMs.toFixed(2)} ms\``,
          },
          {
            type: 'mrkdwn',
            text: `*Región:* \`${result.region}\``,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⏱️ Desglose Telemetría RED:*\n\`DNS: ${result.latency.dnsLookupMs.toFixed(1)}ms\` • \`TCP: ${result.latency.tcpConnectMs.toFixed(1)}ms\` • \`TLS: ${result.latency.tlsHandshakeMs.toFixed(1)}ms\` • \`TTFB: ${result.latency.ttfbMs.toFixed(1)}ms\` • \`Transfer: ${result.latency.contentTransferMs.toFixed(1)}ms\``,
        },
      },
    ];

    if (result.failedAssertions.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⚠️ Aserciones Fallidas:*\n${result.failedAssertions.map((f) => `• ${f}`).join('\n')}`,
        },
      });
    }

    if (result.sslInfo) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*🔒 Certificado SSL / TLS:* Válido por *${result.sslInfo.daysRemaining} días* (${result.sslInfo.issuer})`,
          },
        ],
      });
    }

    if (incident) {
      const incidentInfo = [
        `*💥 Detalles del Incidente & Causa Raíz:*`,
        `• *ID:* \`${incident.id}\` | *Severidad:* \`${incident.severity}\` | *Estado:* \`${incident.status}\``,
        `• *Inicio:* ${incident.startedAt.toISOString()} | *Duración:* *${incident.getDurationMinutes()} min*`,
        `• *Causa Raíz:* ${incident.rootCause ?? incident.summary}`,
        `• *Fallos Consecutivos:* ${incident.consecutiveFailures}`,
      ];

      if (incident.resolvedAt) {
        incidentInfo.push(`• *Resolución:* Mitigado y verificado a las ${incident.resolvedAt.toISOString()}`);
      }

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: incidentInfo.join('\n'),
        },
      });
    }

    return {
      channel: this.config.channel,
      attachments: [
        {
          color,
          blocks,
        },
      ],
    };
  }

  /**
   * Delivers the rich Slack message with exponential retries and backoff.
   */
  public async deliverWithRetry(
    payload: AlertNotificationPayload,
    options?: RetryOptions | number
  ): Promise<SlackDeliveryResult> {
    const slackPayload = this.buildPayload(payload);
    const rawBody = JSON.stringify(slackPayload);

    const retryOpts: RetryOptions =
      typeof options === 'number'
        ? { maxRetries: options }
        : {
            ...options,
          };

    return executeHttpDeliveryWithRetry(
      this.config.webhookUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody,
      },
      retryOpts
    );
  }
}
