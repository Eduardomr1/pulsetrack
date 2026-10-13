import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { desc } from 'drizzle-orm';
import { db } from '@/infrastructure/db/drizzle.client';
import { maintenanceWindowsTable } from '@/infrastructure/db/schema/maintenance-windows.schema';

export async function GET() {
  try {
    const windows = await db
      .select()
      .from(maintenanceWindowsTable)
      .orderBy(desc(maintenanceWindowsTable.startTime));

    const now = Date.now();

    const formatted = windows.map((w) => {
      let currentStatus = w.status;
      const start = w.startTime.getTime();
      const end = w.endTime.getTime();

      if (w.status !== 'COMPLETED') {
        if (now >= start && now <= end) {
          currentStatus = 'IN_PROGRESS';
        } else if (now > end) {
          currentStatus = 'COMPLETED';
        }
      }

      let affected: string[] = [];
      try {
        affected = JSON.parse(w.affectedEndpoints || '[]') as string[];
      } catch {
        affected = [];
      }

      return {
        id: w.id,
        title: w.title,
        description: w.description,
        startTime: w.startTime.toISOString(),
        endTime: w.endTime.toISOString(),
        status: currentStatus,
        affectedEndpoints: affected,
        createdAt: w.createdAt.toISOString(),
      };
    });

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

    if (end.getTime() <= start.getTime()) {
      return NextResponse.json(
        { success: false, error: 'La fecha de fin debe ser posterior a la fecha de inicio' },
        { status: 400 }
      );
    }

    const affected = Array.isArray(body.affectedEndpoints) ? body.affectedEndpoints : ['*'];
    const id = `maint_${randomUUID()}`;

    await db.insert(maintenanceWindowsTable).values({
      id,
      title: String(body.title).trim(),
      description: body.description ? String(body.description).trim() : null,
      startTime: start,
      endTime: end,
      affectedEndpoints: JSON.stringify(affected),
      status: 'SCHEDULED',
      createdAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      message: 'Ventana de mantenimiento programada exitosamente',
      data: { id, title: body.title, startTime: start.toISOString(), endTime: end.toISOString() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al programar mantenimiento';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
