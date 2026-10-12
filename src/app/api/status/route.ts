import { NextResponse } from 'next/server';
import { endpointRepository, healthCheckRepository, incidentRepository } from '@/infrastructure/container';
import { initDatabase } from '@/infrastructure/db/migrate-local';

let isDbReady = false;
async function ensureDb() {
  if (!isDbReady) {
    try {
      await initDatabase();
      isDbReady = true;
    } catch {
      // already initialized
    }
  }
}

export async function GET() {
  try {
    await ensureDb();
    const endpoints = await endpointRepository.findAllActive();
    const recentIncidents = await incidentRepository.findRecent(20);
    const activeIncidents = recentIncidents.filter((i) => i.isOpen());
    const pastIncidents = recentIncidents.filter((i) => i.status === 'RESOLVED');

    const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000);

    let hasDown = false;
    let hasDegraded = false;

    const services = await Promise.all(
      endpoints.map(async (ep) => {
        const latest = await healthCheckRepository.findLatestByEndpointId(ep.id);
        const agg24h = await healthCheckRepository.getAggregates(ep.id, oneDayAgo);
        const agg90d = await healthCheckRepository.getAggregates(ep.id, ninetyDaysAgo);

        const currentStatus = latest ? latest.status.value : 'UNKNOWN';
        if (currentStatus === 'DOWN') hasDown = true;
        if (currentStatus === 'DEGRADED') hasDegraded = true;

        // Fetch recent history samples for the 90-day / 30-slot strip
        const history = await healthCheckRepository.findHistory({
          endpointId: ep.id,
          from: new Date(Date.now() - 30 * 24 * 3600 * 1000),
          to: new Date(),
          limit: 30,
        });

        const slots = history.map((h) => ({
          timestamp: h.timestamp.toISOString(),
          status: h.status.value,
          latencyMs: h.latency.totalMs,
        }));

        return {
          id: ep.id,
          name: ep.name,
          url: ep.url.value,
          tags: ep.tags,
          currentStatus,
          uptime24h: agg24h.uptimePercentage,
          uptime90d: agg90d.uptimePercentage,
          avgLatencyMs: agg24h.avgLatencyMs,
          slots,
        };
      })
    );

    let globalStatus: 'OPERATIONAL' | 'DEGRADED' | 'OUTAGE' = 'OPERATIONAL';
    let globalStatusMessage = 'Todos los sistemas operando con normalidad';

    if (hasDown) {
      globalStatus = 'OUTAGE';
      globalStatusMessage = 'Interrupción en uno o más servicios';
    } else if (hasDegraded) {
      globalStatus = 'DEGRADED';
      globalStatusMessage = 'Rendimiento degradado en algunos componentes';
    }

    return NextResponse.json({
      success: true,
      data: {
        globalStatus,
        globalStatusMessage,
        updatedAt: new Date().toISOString(),
        services,
        activeIncidents: activeIncidents.map((inc) => ({
          id: inc.id,
          endpointId: inc.endpointId,
          severity: inc.severity,
          summary: inc.summary,
          startedAt: inc.startedAt.toISOString(),
        })),
        pastIncidents: pastIncidents.slice(0, 5).map((inc) => ({
          id: inc.id,
          endpointId: inc.endpointId,
          severity: inc.severity,
          summary: inc.summary,
          startedAt: inc.startedAt.toISOString(),
          resolvedAt: inc.resolvedAt?.toISOString() ?? null,
        })),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al consultar estado público';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
