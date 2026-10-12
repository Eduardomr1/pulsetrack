import { NextResponse } from 'next/server';
import { incidentRepository, endpointRepository } from '@/infrastructure/container';

export async function GET() {
  try {
    const recentIncidents = await incidentRepository.findRecent(50);
    const endpoints = await endpointRepository.findAll();
    const endpointMap = new Map(endpoints.map((e) => [e.id, e.name]));

    const open = recentIncidents.filter((i) => i.isOpen());
    const resolved = recentIncidents.filter((i) => i.status === 'RESOLVED');

    // Calculate MTTR (Mean Time To Resolution)
    let totalResolvedDurationMs = 0;
    for (const r of resolved) {
      if (r.resolvedAt) {
        totalResolvedDurationMs += r.resolvedAt.getTime() - r.startedAt.getTime();
      }
    }

    const mttrMinutes =
      resolved.length > 0
        ? Math.round((totalResolvedDurationMs / resolved.length / (1000 * 60)) * 10) / 10
        : 0;

    const data = {
      summary: {
        activeCount: open.length,
        resolvedCount: resolved.length,
        mttrMinutes,
      },
      activeIncidents: open.map((i) => ({
        id: i.id,
        endpointId: i.endpointId,
        endpointName: endpointMap.get(i.endpointId) ?? 'Servicio Desconocido',
        status: i.status,
        severity: i.severity,
        startedAt: i.startedAt.toISOString(),
        durationMinutes: Math.round((Date.now() - i.startedAt.getTime()) / (1000 * 60)),
        summary: i.summary,
        consecutiveFailures: i.consecutiveFailures,
      })),
      recentResolved: resolved.slice(0, 10).map((i) => ({
        id: i.id,
        endpointId: i.endpointId,
        endpointName: endpointMap.get(i.endpointId) ?? 'Servicio Desconocido',
        status: i.status,
        severity: i.severity,
        startedAt: i.startedAt.toISOString(),
        resolvedAt: i.resolvedAt?.toISOString() ?? null,
        durationMinutes: i.resolvedAt
          ? Math.round((i.resolvedAt.getTime() - i.startedAt.getTime()) / (1000 * 60))
          : 0,
        summary: i.summary,
        consecutiveFailures: i.consecutiveFailures,
      })),
    };

    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al consultar incidentes';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
