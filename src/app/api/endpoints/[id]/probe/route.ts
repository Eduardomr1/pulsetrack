import { NextResponse } from 'next/server';
import { endpointRepository, executeProbeUseCase } from '@/infrastructure/container';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const endpoint = await endpointRepository.findById(id);

    if (!endpoint) {
      return NextResponse.json(
        { success: false, error: `Endpoint ${id} no encontrado` },
        { status: 404 }
      );
    }

    const result = await executeProbeUseCase.execute({ endpoint });

    return NextResponse.json({
      success: true,
      data: {
        id: result.id,
        endpointId: result.endpointId,
        timestamp: result.timestamp.toISOString(),
        status: result.status.value,
        statusCode: result.statusCode,
        statusText: result.statusText,
        latency: result.latency.toJSON(),
        sslInfo: result.sslInfo,
        failedAssertions: result.failedAssertions,
        errorMessage: result.errorMessage,
        region: result.region,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al sondar endpoint';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
