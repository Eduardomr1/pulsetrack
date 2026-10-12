import { IAlertNotifier, AlertNotificationPayload } from '../../core/domain/ports/notifier.port';
import { DiscordConfig } from '../../core/domain/entities/alert-channel.entity';

export interface DiscordDeliveryResult {
  success: boolean;
  statusCode?: number;
  errorMessage?: string;
}

export class DiscordNotifierAgent implements IAlertNotifier {
  constructor(private readonly config: DiscordConfig) {}

  public async notify(payload: AlertNotificationPayload): Promise<void> {
    await this.deliver(payload);
  }

  public async deliver(payload: AlertNotificationPayload): Promise<DiscordDeliveryResult> {
    const { endpoint, result, incident, type } = payload;

    const isDown = type === 'DOWN';
    const isDegraded = type === 'DEGRADED';

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
        name: '🌍 Región',
        value: `\`${result.region}\``,
        inline: true,
      },
      {
        name: '⏱️ Desglose de Fases (RED Telemetry)',
        value: `\`DNS:\` ${result.latency.dnsLookupMs}ms | \`TCP:\` ${result.latency.tcpConnectMs}ms | \`TLS:\` ${result.latency.tlsHandshakeMs}ms | \`TTFB:\` ${result.latency.ttfbMs}ms`,
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
        value: `Válido: **${result.sslInfo.daysRemaining} días** restantes (${result.sslInfo.issuer})`,
        inline: false,
      });
    }

    let description = `La sonda de salud ha registrado un cambio de estado a **${type}**.`;
    if (incident) {
      description = `**Incidente:** ${incident.summary}\n**Fallos Consecutivos:** ${incident.consecutiveFailures} | **Severidad:** ${incident.severity}`;
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
      content = `<@&${this.config.mentionRoleId}> Incidente crítico detectado en ${endpoint.name}!`;
    }

    const discordPayload = {
      username: this.config.username ?? 'PulseTrack Bot',
      avatar_url: this.config.avatarUrl,
      content,
      embeds: [embed],
    };

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discordPayload),
      });

      if (!response.ok) {
        return {
          success: false,
          statusCode: response.status,
          errorMessage: `Discord API error: ${response.status} ${response.statusText}`,
        };
      }

      return { success: true, statusCode: 204 };
    } catch (err: unknown) {
      return {
        success: false,
        errorMessage: err instanceof Error ? err.message : 'Error de conexión con Discord',
      };
    }
  }
}
