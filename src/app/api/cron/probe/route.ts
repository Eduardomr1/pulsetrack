import { NextResponse } from 'next/server';
import { endpointRepository, executeProbeUseCase } from '@/infrastructure/container';
import { initDatabase } from '@/infrastructure/db/migrate-local';
import { HealthStatusType } from '@/core/domain/value-objects/health-status.vo';

let isDbReady = false;
async function ensureDb() {
  if (!isDbReady) {
    try {
      await initDatabase();
      isDbReady = true;
    } catch {
      // already ready
    }
  }
}

export async function GET(req: Request) {
  try {
    await ensureDb();

    // Verify optional authorization secret if set
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const activeEndpoints = await endpointRepository.findAllActive();
    const results = await Promise.allSettled(
      activeEndpoints.map(async (endpoint) => {
        const res = await executeProbeUseCase.execute({ endpoint });
        return {
          endpointId: endpoint.id,
          name: endpoint.name,
          status: res.status.value,
          latencyMs: res.latency.totalMs,
        };
      })
    );

    const successful = results
      .filter((r): r is PromiseFulfilledResult<{ endpointId: string; name: string; status: HealthStatusType; latencyMs: number }> => r.status === 'fulfilled')
      .map((r) => r.value);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      probedCount: successful.length,
      results: successful,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error en cron de sondeo';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
