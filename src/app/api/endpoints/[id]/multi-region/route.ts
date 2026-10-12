import { NextRequest, NextResponse } from 'next/server';
import { endpointRepository, multiRegionSimulatorService } from '@/infrastructure/container';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const endpoint = await endpointRepository.findById(id);

    if (!endpoint) {
      return NextResponse.json(
        { success: false, error: 'Endpoint no encontrado' },
        { status: 404 }
      );
    }

    const regionalResults = await multiRegionSimulatorService.probeAllRegions(endpoint);

    return NextResponse.json({
      success: true,
      data: {
        endpointId: endpoint.id,
        endpointName: endpoint.name,
        targetUrl: endpoint.url.value,
        timestamp: new Date().toISOString(),
        regions: regionalResults,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al sondar regiones';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Re-use same handler for POST
  return GET(_request, { params });
}
