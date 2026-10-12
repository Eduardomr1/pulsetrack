import { IAlertNotifier, AlertNotificationPayload } from '../../core/domain/ports/notifier.port';
import { SlackConfig } from '../../core/domain/entities/alert-channel.entity';

export interface SlackDeliveryResult {
  success: boolean;
  statusCode?: number;
  errorMessage?: string;
}

export class SlackNotifierAgent implements IAlertNotifier {
  constructor(private readonly config: SlackConfig) {}

  public async notify(payload: AlertNotificationPayload): Promise<void> {
    await this.deliver(payload);
  }

  public async deliver(payload: AlertNotificationPayload): Promise<SlackDeliveryResult> {
    const { endpoint, result, incident, type } = payload;

    const isDown = type === 'DOWN';
    const isDegraded = type === 'DEGRADED';

    const color = isDown ? '#EF4444' : isDegraded ? '#F59E0B' : '#10B981';
    const emoji = isDown ? '🚨' : isDegraded ? '⚠️' : '✅';
    const headline = isDown
      ? `Caída de Servicio Detectada (DOWN)`
      : isDegraded
      ? `Degradación de Rendimiento / SLA (DEGRADED)`
      : `Servicio Recuperado (RECOVERED)`;

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
          text: `${mentionPrefix}*Endpoint:* <${endpoint.url.value}|${endpoint.name}>\n*Método:* \`${endpoint.method.value}\` | *Intervalo:* ${endpoint.intervalSeconds}s`,
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
          text: `*⏱️ Desglose Telemetría RED:* \n\`DNS: ${result.latency.dnsLookupMs}ms\` • \`TCP: ${result.latency.tcpConnectMs}ms\` • \`TLS: ${result.latency.tlsHandshakeMs}ms\` • \`TTFB: ${result.latency.ttfbMs}ms\``,
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

    if (incident) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*Incidente ID:* \`${incident.id}\` | *Fallos Consecutivos:* ${incident.consecutiveFailures} | *Severidad:* \`${incident.severity}\``,
          },
        ],
      });
    }

    const slackPayload = {
      channel: this.config.channel,
      attachments: [
        {
          color,
          blocks,
        },
      ],
    };

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackPayload),
      });

      if (!response.ok) {
        return {
          success: false,
          statusCode: response.status,
          errorMessage: `Slack API error: ${response.status} ${response.statusText}`,
        };
      }

      return { success: true, statusCode: 200 };
    } catch (err: unknown) {
      return {
        success: false,
        errorMessage: err instanceof Error ? err.message : 'Error de conexión con Slack',
      };
    }
  }
}
