import { IAlertNotifier, AlertNotificationPayload } from '../../core/domain/ports/notifier.port';
import { DiscordConfig } from '../../core/domain/entities/alert-channel.entity';
import {
  executeHttpDeliveryWithRetry,
  RetryOptions,
  DiscordDeliveryResult,
} from './retry.util';

export type { DiscordDeliveryResult };

export class DiscordNotifierAgent implements IAlertNotifier {
  constructor(private readonly config: DiscordConfig) {}

  public async notify(payload: AlertNotificationPayload): Promise<void> {
    await this.deliverWithRetry(payload);
  }

  public async deliver(payload: AlertNotificationPayload): Promise<DiscordDeliveryResult> {
    return this.deliverWithRetry(payload);
  }

  /**
   * Builds the rich Discord webhook embed payload with full RED latency metrics,
   * incident lifecycle (start, duration, root cause, resolution), and role mentions.
   */
  public buildPayload(payload: AlertNotificationPayload) {
    const { endpoint, result, incident, type } = payload;

    const isDown = type === 'DOWN';
    const isDegraded = type === 'DEGRADED';
    const isRecovered = type === 'RECOVERED';

    const color = isDown ? 0xef4444 : isDegraded ? 0xf59e0b : 0x10b981;
    const emoji = isDown ? '🚨' : isDegraded ? '⚠️' : '✅';
    const title = `${emoji} [${type}] ${endpoint.name}`;

    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      {
        name: '🌐 URL & Método',
        value: `\`${endpoint.method.value}\` [${endpoint.url.value}](${endpoint.url.value})`,
        inline: false,
      },
      {
        name: '📊 Estado HTTP',
        value: `\`${result.statusCode ?? 'N/A'}\` ${result.statusText ?? ''}`,
        inline: true,
      },
      {
        name: '⚡ Latencia Total',
        value: `**${result.latency.totalMs.toFixed(2)} ms**`,
        inline: true,
      },
      {
        name: '🌍 Región Sonda',
        value: `\`${result.region}\``,
        inline: true,
      },
      {
        name: '⏱️ Desglose Telemetría RED',
        value: `\`DNS:\` ${result.latency.dnsLookupMs.toFixed(1)}ms | \`TCP:\` ${result.latency.tcpConnectMs.toFixed(1)}ms | \`TLS:\` ${result.latency.tlsHandshakeMs.toFixed(1)}ms | \`TTFB:\` ${result.latency.ttfbMs.toFixed(1)}ms | \`Transfer:\` ${result.latency.contentTransferMs.toFixed(1)}ms`,
        inline: false,
      },
    ];

    if (result.failedAssertions.length > 0) {
      fields.push({
        name: '⚠️ Aserciones Fallidas',
        value: result.failedAssertions.map((f) => `• ${f}`).join('\n'),
        inline: false,
      });
    }

    if (result.sslInfo) {
      fields.push({
        name: '🔒 Certificado SSL / TLS',
        value: `Válido: **${result.sslInfo.daysRemaining} días restantes** (${result.sslInfo.issuer})`,
        inline: false,
      });
    }

    if (incident) {
      const incidentLines = [
        `• **ID Incidente:** \`${incident.id}\``,
        `• **Severidad:** \`${incident.severity}\` | **Estado:** \`${incident.status}\``,
        `• **Inicio:** \`${incident.startedAt.toISOString()}\``,
        `• **Duración:** **${incident.getDurationMinutes()} min**`,
        `• **Fallos Consecutivos:** \`${incident.consecutiveFailures}\``,
        `• **Causa Raíz:** ${incident.rootCause ?? incident.summary}`,
      ];

      if (incident.resolvedAt) {
        incidentLines.push(`• **Resolución:** Mitigado a las \`${incident.resolvedAt.toISOString()}\``);
      }

      fields.push({
        name: '💥 Registro de Incidente & Causa Raíz',
        value: incidentLines.join('\n'),
        inline: false,
      });
    }

    let description = isDown
      ? '🚨 **Caída de Servicio Crítica:** La sonda HTTP detectó indisponibilidad o fallo severo de conectividad.'
      : isDegraded
      ? '⚠️ **Degradación de Rendimiento / SLA:** El endpoint responde pero sobrepasa los umbrales de latencia estipulados.'
      : '✅ **Servicio Recuperado:** La sonda ha verificado que el servicio ha vuelto a operar dentro de parámetros normales.';

    if (incident && !isRecovered) {
      description += `\n**Resumen:** ${incident.summary}`;
    }

    const embed = {
      title,
      url: endpoint.url.value,
      description,
      color,
      fields,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'PulseTrack Observability Agent • Engine v1.0',
      },
    };

    let content: string | undefined = undefined;
    if (isDown && this.config.mentionRoleId) {
      content = `<@&${this.config.mentionRoleId}> 🚨 ¡Incidente crítico detectado en ${endpoint.name}!`;
    }

    return {
      username: this.config.username ?? 'PulseTrack Bot',
      avatar_url: this.config.avatarUrl,
      content,
      embeds: [embed],
    };
  }

  /**
   * Delivers the rich Discord embed with exponential retries and error backoff.
   */
  public async deliverWithRetry(
    payload: AlertNotificationPayload,
    options?: RetryOptions | number
  ): Promise<DiscordDeliveryResult> {
    const discordPayload = this.buildPayload(payload);
    const rawBody = JSON.stringify(discordPayload);

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
