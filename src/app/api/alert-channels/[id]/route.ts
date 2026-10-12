import { NextResponse } from 'next/server';
import {
  alertChannelRepository,
  alertManagerService,
} from '@/infrastructure/container';
import { initDatabase } from '@/infrastructure/db/migrate-local';
import {
  AlertEventType,
  ChannelConfig,
} from '@/core/domain/entities/alert-channel.entity';

let isDbReady = false;
async function ensureDb() {
  if (!isDbReady) {
    await initDatabase();
    const storedChannels = await alertChannelRepository.findAll();
    for (const channel of storedChannels) {
      alertManagerService.registerChannel(channel);
    }
    isDbReady = true;
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDb();
    const { id } = await params;

    const channel = await alertChannelRepository.findById(id);
    if (!channel) {
      return NextResponse.json(
        { success: false, error: `Canal de alerta ${id} no encontrado` },
        { status: 404 }
      );
    }

    await alertChannelRepository.delete(id);
    alertManagerService.unregisterChannel(id);

    return NextResponse.json({
      success: true,
      message: `Canal de alerta '${channel.name}' eliminado exitosamente`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al eliminar canal de alerta';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDb();
    const { id } = await params;

    const channel = await alertChannelRepository.findById(id);
    if (!channel) {
      return NextResponse.json(
        { success: false, error: `Canal de alerta ${id} no encontrado` },
        { status: 404 }
      );
    }

    const body = (await req.json()) as {
      isEnabled?: boolean;
      name?: string;
      events?: AlertEventType[];
      config?: Partial<ChannelConfig>;
      webhookUrl?: string;
    };

    if (typeof body.isEnabled === 'boolean') {
      if (body.isEnabled) {
        channel.enable();
      } else {
        channel.disable();
      }
    }

    if (body.name && body.name.trim().length > 0) {
      channel.name = body.name.trim();
    }

    if (body.events && Array.isArray(body.events) && body.events.length > 0) {
      channel.events = body.events;
    }

    if (body.webhookUrl && body.webhookUrl.trim().startsWith('http')) {
      channel.config = {
        ...channel.config,
        webhookUrl: body.webhookUrl.trim(),
      } as ChannelConfig;
    }

    if (body.config) {
      channel.config = {
        ...channel.config,
        ...body.config,
      } as ChannelConfig;
    }

    channel.updatedAt = new Date();

    await alertChannelRepository.update(channel);
    alertManagerService.registerChannel(channel);

    return NextResponse.json({
      success: true,
      data: {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        config: channel.config,
        events: channel.events,
        isEnabled: channel.isEnabled,
        updatedAt: channel.updatedAt.toISOString(),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al actualizar canal de alerta';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
