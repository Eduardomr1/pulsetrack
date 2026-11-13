import { NextRequest, NextResponse } from 'next/server';
import {
  maintenanceWindowRepository,
  scheduleMaintenanceWindowUseCase,
} from '@/infrastructure/container';

export async function GET() {
  try {
    const windows = await maintenanceWindowRepository.findAll();
    const now = new Date();

    const formatted = windows.map((w) => ({
      id: w.id,
      title: w.title,
      description: w.description,
      startTime: w.startTime.toISOString(),
      endTime: w.endTime.toISOString(),
      status: w.getDynamicStatus(now),
      affectedEndpoints: [...w.affectedEndpoints],
      createdAt: w.createdAt.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      data: formatted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener ventanas de mantenimiento';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.title || !body.startTime || !body.endTime) {
      return NextResponse.json(
        { success: false, error: 'Título, fecha de inicio y fecha de fin son obligatorios' },
        { status: 400 }
      );
    }

    const start = new Date(body.startTime);
    const end = new Date(body.endTime);

    const { window: scheduled, advisory } = await scheduleMaintenanceWindowUseCase.execute({
      title: String(body.title),
      description: body.description ? String(body.description) : null,
      startTime: start,
      endTime: end,
      affectedEndpoints: Array.isArray(body.affectedEndpoints) ? body.affectedEndpoints : ['*'],
      rejectOnOverlapConflict: Boolean(body.rejectOnOverlapConflict),
    });

    return NextResponse.json({
      success: true,
      message: 'Ventana de mantenimiento programada exitosamente',
      data: {
        id: scheduled.id,
        title: scheduled.title,
        startTime: scheduled.startTime.toISOString(),
        endTime: scheduled.endTime.toISOString(),
        affectedEndpoints: [...scheduled.affectedEndpoints],
        advisory,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al programar mantenimiento';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
