import { NextResponse } from 'next/server';
import {
  alertChannelRepository,
  alertManagerService,
} from '@/infrastructure/container';
import { initDatabase } from '@/infrastructure/db/migrate-local';

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

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDb();
    const { id } = await params;

    const channel = await alertChannelRepository.findById(id);
    if (!channel) {
      return NextResponse.json(
        {
          success: false,
          statusCode: 404,
          error: `Canal de alerta ${id} no encontrado`,
        },
        { status: 404 }
      );
    }

    const testResult = await alertManagerService.testChannel(channel);

    return NextResponse.json({
      success: testResult.success,
      statusCode: testResult.statusCode,
      error: testResult.error,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al enviar notificación de prueba';
    return NextResponse.json(
      {
        success: false,
        statusCode: 500,
        error: message,
      },
      { status: 500 }
    );
  }
}
