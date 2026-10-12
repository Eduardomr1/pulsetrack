import { randomUUID } from 'node:crypto';
import { IAlertNotifier, AlertNotificationPayload } from '../../core/domain/ports/notifier.port';
import { AlertChannel, AlertEventType, WebhookConfig, SlackConfig, DiscordConfig } from '../../core/domain/entities/alert-channel.entity';
import { WebhookNotifierAgent } from './webhook-notifier.agent';
import { SlackNotifierAgent } from './slack-notifier.agent';
import { DiscordNotifierAgent } from './discord-notifier.agent';
import { Database } from '../db/drizzle.client';
import { Endpoint } from '../../core/domain/entities/endpoint.entity';
import { HealthCheckResult } from '../../core/domain/entities/health-check.entity';
import { UrlVo } from '../../core/domain/value-objects/url.vo';
import { HttpMethodVo } from '../../core/domain/value-objects/http-method.vo';
import { HealthStatusVo } from '../../core/domain/value-objects/health-status.vo';
import { LatencyBreakdownVo } from '../../core/domain/value-objects/latency-breakdown.vo';
import { notificationLogsTable } from '../db/schema/alert-channels.schema';

export interface ThrottlingConfig {
  cooldownSeconds: number; // Minimal seconds between identical alerts for same endpoint
}

export class AlertManagerService implements IAlertNotifier {
  private readonly channels: Map<string, { channel: AlertChannel; agent: IAlertNotifier }> = new Map();
  private readonly lastNotifiedMap: Map<string, number> = new Map();

  constructor(
    private readonly db?: Database,
    private readonly throttling: ThrottlingConfig = { cooldownSeconds: 30 }
  ) {}

  public registerChannel(channel: AlertChannel): void {
    let agent: IAlertNotifier;

    switch (channel.type) {
      case 'WEBHOOK':
        agent = new WebhookNotifierAgent(channel.config as WebhookConfig);
        break;
      case 'SLACK':
        agent = new SlackNotifierAgent(channel.config as SlackConfig);
        break;
      case 'DISCORD':
        agent = new DiscordNotifierAgent(channel.config as DiscordConfig);
        break;
      default:
        throw new Error(`Tipo de canal no soportado: ${channel.type}`);
    }

    this.channels.set(channel.id, { channel, agent });
    console.log(`[PulseTrack AlertManager] Canal registrado: ${channel.name} (${channel.type})`);
  }

  public unregisterChannel(channelId: string): void {
    this.channels.delete(channelId);
  }

  public getRegisteredChannels(): AlertChannel[] {
    return Array.from(this.channels.values()).map((c) => c.channel);
  }

  public getChannel(channelId: string): AlertChannel | undefined {
    return this.channels.get(channelId)?.channel;
  }

  public async testChannel(
    channel: AlertChannel
  ): Promise<{ success: boolean; statusCode: number; error?: string }> {
    let agent: IAlertNotifier;

    switch (channel.type) {
      case 'WEBHOOK':
        agent = new WebhookNotifierAgent(channel.config as WebhookConfig);
        break;
      case 'SLACK':
        agent = new SlackNotifierAgent(channel.config as SlackConfig);
        break;
      case 'DISCORD':
        agent = new DiscordNotifierAgent(channel.config as DiscordConfig);
        break;
      default:
        return { success: false, statusCode: 400, error: `Tipo de canal no soportado: ${channel.type}` };
    }

    const testEndpoint = new Endpoint({
      id: 'probe-test-connection',
      name: 'PulseTrack Health Probe [Test Connection]',
      url: new UrlVo('https://pulsetrack.internal/health'),
      method: new HttpMethodVo('GET'),
      headers: {},
      intervalSeconds: 30,
      timeoutMs: 5000,
      expectedStatusCodes: [200],
      assertions: [],
      isActive: true,
      tags: ['test', 'connectivity-check'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const testResult = new HealthCheckResult({
      id: 'check-test-connection',
      endpointId: 'probe-test-connection',
      timestamp: new Date(),
      status: HealthStatusVo.HEALTHY,
      statusCode: 200,
      statusText: 'OK',
      latency: new LatencyBreakdownVo({
        dnsLookupMs: 2.4,
        tcpConnectMs: 5.1,
        tlsHandshakeMs: 10.2,
        ttfbMs: 31.5,
        contentTransferMs: 1.8,
        totalMs: 51.0,
      }),
      errorMessage: null,
      failedAssertions: [],
      responseHeaders: { 'content-type': 'application/json' },
      region: 'us-east-edge',
    });

    const testPayload: AlertNotificationPayload = {
      endpoint: testEndpoint,
      result: testResult,
      type: 'RECOVERED',
    };

    try {
      if (agent instanceof WebhookNotifierAgent) {
        const res = await agent.deliverWithRetry(testPayload, 1);
        return {
          success: res.success,
          statusCode: res.statusCode ?? (res.success ? 200 : 500),
          error: res.errorMessage,
        };
      } else if (agent instanceof SlackNotifierAgent) {
        const res = await agent.deliver(testPayload);
        return {
          success: res.success,
          statusCode: res.statusCode ?? (res.success ? 200 : 500),
          error: res.errorMessage,
        };
      } else if (agent instanceof DiscordNotifierAgent) {
        const res = await agent.deliver(testPayload);
        return {
          success: res.success,
          statusCode: res.statusCode ?? (res.success ? 204 : 500),
          error: res.errorMessage,
        };
      }

      await agent.notify(testPayload);
      return { success: true, statusCode: 200 };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Error inesperado al probar canal';
      return { success: false, statusCode: 500, error: errorMsg };
    }
  }

  public async notify(payload: AlertNotificationPayload): Promise<void> {
    const { endpoint, type, incident } = payload;

    // Check Throttling / Anti-Flapping
    const throttleKey = `${endpoint.id}:${type}`;
    const now = Date.now();
    const lastNotified = this.lastNotifiedMap.get(throttleKey) ?? 0;
    const cooldownMs = this.throttling.cooldownSeconds * 1000;

    if (now - lastNotified < cooldownMs && type !== 'RECOVERED') {
      console.warn(
        `[PulseTrack AlertManager] Alerta throttled para ${endpoint.name} (${type}): en período de cooldown.`
      );
      return;
    }

    this.lastNotifiedMap.set(throttleKey, now);

    // Dispatch to all matching active channels in parallel
    const activeEntries = Array.from(this.channels.values()).filter(({ channel }) =>
      channel.shouldNotify(type as AlertEventType)
    );

    if (activeEntries.length === 0) {
      return;
    }

    await Promise.allSettled(
      activeEntries.map(async ({ channel, agent }) => {
        let status = 'SENT';
        let errorMessage: string | null = null;
        let responseCode: number | null = null;

        try {
          if (agent instanceof WebhookNotifierAgent) {
            const res = await agent.deliverWithRetry(payload);
            status = res.success ? 'SENT' : 'FAILED';
            errorMessage = res.errorMessage ?? null;
            responseCode = res.statusCode ?? null;
          } else if (agent instanceof SlackNotifierAgent) {
            const res = await agent.deliver(payload);
            status = res.success ? 'SENT' : 'FAILED';
            errorMessage = res.errorMessage ?? null;
            responseCode = res.statusCode ?? null;
          } else if (agent instanceof DiscordNotifierAgent) {
            const res = await agent.deliver(payload);
            status = res.success ? 'SENT' : 'FAILED';
            errorMessage = res.errorMessage ?? null;
            responseCode = res.statusCode ?? null;
          } else {
            await agent.notify(payload);
          }
        } catch (err: unknown) {
          status = 'FAILED';
          errorMessage = err instanceof Error ? err.message : 'Error inesperado';
        }

        // Audit Log into Drizzle ORM if db is configured
        if (this.db) {
          try {
            await this.db.insert(notificationLogsTable).values({
              id: randomUUID(),
              channelId: channel.id,
              endpointId: endpoint.id,
              incidentId: incident?.id ?? null,
              eventType: type,
              status,
              responseCode,
              errorMessage,
              timestamp: new Date(),
            });
          } catch (logErr) {
            console.error('[PulseTrack AlertManager] Error guardando log de notificación:', logErr);
          }
        }
      })
    );
  }
}
