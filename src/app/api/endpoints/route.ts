import { NextResponse } from 'next/server';
import { endpointRepository, healthCheckRepository, registerEndpointUseCase } from '@/infrastructure/container';
import { initDatabase } from '@/infrastructure/db/migrate-local';
import { CreateEndpointDto } from '@/core/application/dtos/endpoint.dto';

let isDbReady = false;
async function ensureDb() {
  if (!isDbReady) {
    await initDatabase();
    isDbReady = true;
  }
}

export async function GET() {
  try {
    await ensureDb();
    const endpoints = await endpointRepository.findAll();
    const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000);

    const data = await Promise.all(
      endpoints.map(async (ep) => {
        const latest = await healthCheckRepository.findLatestByEndpointId(ep.id);
        const aggregates = await healthCheckRepository.getAggregates(ep.id, oneDayAgo);

        return {
          id: ep.id,
          name: ep.name,
          url: ep.url.value,
          method: ep.method.value,
          intervalSeconds: ep.intervalSeconds,
          timeoutMs: ep.timeoutMs,
          isActive: ep.isActive,
          tags: ep.tags,
          createdAt: ep.createdAt.toISOString(),
          latestCheck: latest
            ? {
                id: latest.id,
                timestamp: latest.timestamp.toISOString(),
                status: latest.status.value,
                statusCode: latest.statusCode,
                latency: latest.latency.toJSON(),
                sslInfo: latest.sslInfo,
                failedAssertions: latest.failedAssertions,
                errorMessage: latest.errorMessage,
              }
            : null,
          aggregates,
        };
      })
    );

    return NextResponse.json({ success: true, count: data.length, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureDb();
    const body = (await req.json()) as CreateEndpointDto;

    if (!body.name || !body.url) {
      return NextResponse.json(
        { success: false, error: 'Campos requeridos faltantes: "name" y "url"' },
        { status: 400 }
      );
    }

    const endpoint = await registerEndpointUseCase.execute(body);

    return NextResponse.json({
      success: true,
      data: {
        id: endpoint.id,
        name: endpoint.name,
        url: endpoint.url.value,
        method: endpoint.method.value,
        intervalSeconds: endpoint.intervalSeconds,
        timeoutMs: endpoint.timeoutMs,
        isActive: endpoint.isActive,
      },
    }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al registrar endpoint';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
