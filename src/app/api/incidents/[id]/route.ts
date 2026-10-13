import { NextRequest, NextResponse } from 'next/server';
import { incidentRepository, endpointRepository, telemetryEventBus } from '@/infrastructure/container';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const incident = await incidentRepository.findById(id);

    if (!incident) {
      return NextResponse.json(
        { success: false, error: 'Incidente no encontrado' },
        { status: 404 }
      );
    }

    const endpoint = await endpointRepository.findById(incident.endpointId);

    return NextResponse.json({
      success: true,
      data: {
        id: incident.id,
        endpointId: incident.endpointId,
        endpointName: endpoint?.name ?? 'Desconocido',
        targetUrl: endpoint?.url.value ?? '',
        status: incident.status,
        severity: incident.severity,
        summary: incident.summary,
        rootCause: incident.rootCause,
        startedAt: incident.startedAt.toISOString(),
        acknowledgedAt: incident.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: incident.resolvedAt?.toISOString() ?? null,
        durationMinutes: incident.getDurationMinutes(),
        timeToAcknowledgeMinutes: incident.getTimeToAcknowledgeMinutes(),
        consecutiveFailures: incident.consecutiveFailures,
        timeline: incident.timeline,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener incidente';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const incident = await incidentRepository.findById(id);

    if (!incident) {
      return NextResponse.json(
        { success: false, error: 'Incidente no encontrado' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const action = String(body.action ?? '').toUpperCase();
    const author = String(body.author ?? 'On-Call Engineer');

    if (action === 'ACKNOWLEDGE') {
      incident.acknowledge(new Date(), body.note, author);
    } else if (action === 'ADD_NOTE') {
      if (!body.message) {
        return NextResponse.json(
          { success: false, error: 'Se requiere el mensaje para la nota de la bitácora' },
          { status: 400 }
        );
      }
      incident.addTimelineNote(String(body.message), author);
    } else if (action === 'RESOLVE') {
      incident.resolve(new Date(), body.rootCause, author);
    } else {
      return NextResponse.json(
        { success: false, error: `Acción no soportada: ${action}. Use ACKNOWLEDGE, ADD_NOTE o RESOLVE.` },
        { status: 400 }
      );
    }

    await incidentRepository.update(incident);

    // Notify telemetry subscribers
    telemetryEventBus.emit('incident:updated', {
      incidentId: incident.id,
      endpointId: incident.endpointId,
      status: incident.status,
      timestamp: new Date(),
    });

    return NextResponse.json({
      success: true,
      message: `Incidente actualizado exitosamente (${action})`,
      data: {
        id: incident.id,
        status: incident.status,
        timeline: incident.timeline,
        acknowledgedAt: incident.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: incident.resolvedAt?.toISOString() ?? null,
        rootCause: incident.rootCause,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al actualizar incidente';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
