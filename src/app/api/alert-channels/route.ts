import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import {
  alertChannelRepository,
  alertManagerService,
} from '@/infrastructure/container';
import { initDatabase } from '@/infrastructure/db/migrate-local';
import {
  AlertChannel,
  AlertChannelType,
  AlertEventType,
  ChannelConfig,
  WebhookConfig,
  SlackConfig,
  DiscordConfig,
} from '@/core/domain/entities/alert-channel.entity';

let isDbReady = false;
async function ensureDb() {
  if (!isDbReady) {
    await initDatabase();
    // Synchronize stored channels with AlertManagerService
    const storedChannels = await alertChannelRepository.findAll();
    for (const channel of storedChannels) {
      alertManagerService.registerChannel(channel);
    }
    isDbReady = true;
  }
}

export async function GET() {
  try {
    await ensureDb();
    const channels = await alertChannelRepository.findAll();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const data = await Promise.all(
      channels.map(async (channel) => {
        const alertsSent24h = await alertChannelRepository.countAlertsSentSince(
          channel.id,
          oneDayAgo
        );

        return {
          id: channel.id,
          name: channel.name,
          type: channel.type,
          config: channel.config,
          events: channel.events,
          isEnabled: channel.isEnabled,
          createdAt: channel.createdAt.toISOString(),
          updatedAt: channel.updatedAt.toISOString(),
          alertsSent24h,
        };
      })
    );

    return NextResponse.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al obtener canales de alerta';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureDb();
    const body = (await req.json()) as {
      id?: string;
      name?: string;
      type?: AlertChannelType;
      webhookUrl?: string;
      config?: ChannelConfig;
      events?: AlertEventType[];
      isEnabled?: boolean;
      // Extra fields for Slack/Discord/Webhook
      secretKey?: string;
      timeoutMs?: number;
      channel?: string;
      mentionOnCritical?: boolean;
      username?: string;
      avatarUrl?: string;
      mentionRoleId?: string;
    };

    if (!body.name || body.name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'El nombre del canal de alerta es requerido' },
        { status: 400 }
      );
    }

    if (!body.type || !['WEBHOOK', 'SLACK', 'DISCORD'].includes(body.type)) {
      return NextResponse.json(
        { success: false, error: 'Tipo de canal inválido. Debe ser WEBHOOK, SLACK o DISCORD' },
        { status: 400 }
      );
    }

    const webhookUrl = body.config?.webhookUrl || body.webhookUrl;
    if (!webhookUrl || !webhookUrl.trim().startsWith('http')) {
      return NextResponse.json(
        { success: false, error: 'La URL del webhook debe ser una URL válida (http/https)' },
        { status: 400 }
      );
    }

    let config: ChannelConfig;
    if (body.type === 'WEBHOOK') {
      const webhookConfig: WebhookConfig = {
        webhookUrl: webhookUrl.trim(),
        secretKey: body.config && 'secretKey' in body.config ? body.config.secretKey : body.secretKey,
        timeoutMs: body.config && 'timeoutMs' in body.config ? body.config.timeoutMs : body.timeoutMs ?? 5000,
        headers: body.config && 'headers' in body.config ? body.config.headers : undefined,
      };
      config = webhookConfig;
    } else if (body.type === 'SLACK') {
      const slackConfig: SlackConfig = {
        webhookUrl: webhookUrl.trim(),
        channel: body.config && 'channel' in body.config ? body.config.channel : body.channel,
        mentionOnCritical:
          body.config && 'mentionOnCritical' in body.config
            ? body.config.mentionOnCritical
            : body.mentionOnCritical ?? true,
      };
      config = slackConfig;
    } else {
      const discordConfig: DiscordConfig = {
        webhookUrl: webhookUrl.trim(),
        username: body.config && 'username' in body.config ? body.config.username : body.username,
        avatarUrl: body.config && 'avatarUrl' in body.config ? body.config.avatarUrl : body.avatarUrl,
        mentionRoleId:
          body.config && 'mentionRoleId' in body.config
            ? body.config.mentionRoleId
            : body.mentionRoleId,
      };
      config = discordConfig;
    }

    const events: AlertEventType[] =
      body.events && Array.isArray(body.events) && body.events.length > 0
        ? body.events
        : ['DOWN', 'DEGRADED', 'RECOVERED'];

    const channel = new AlertChannel({
      id: body.id ?? randomUUID(),
      name: body.name.trim(),
      type: body.type,
      config,
      events,
      isEnabled: body.isEnabled ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await alertChannelRepository.save(channel);
    alertManagerService.registerChannel(channel);

    return NextResponse.json(
      {
        success: true,
        data: {
          id: channel.id,
          name: channel.name,
          type: channel.type,
          config: channel.config,
          events: channel.events,
          isEnabled: channel.isEnabled,
          createdAt: channel.createdAt.toISOString(),
          updatedAt: channel.updatedAt.toISOString(),
          alertsSent24h: 0,
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al crear canal de alerta';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
