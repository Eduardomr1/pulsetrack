import { NextRequest, NextResponse } from 'next/server';
import { endpointRepository, healthCheckRepository } from '@/infrastructure/container';
import { UrlVo } from '@/core/domain/value-objects/url.vo';
import { HttpMethodVo } from '@/core/domain/value-objects/http-method.vo';
import { AssertionVo, AssertionRule } from '@/core/domain/value-objects/assertion.vo';
import { SloCalculatorService } from '@/core/domain/services/slo-calculator.service';

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

    const latestCheck = await healthCheckRepository.findLatestByEndpointId(id);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const aggregates = await healthCheckRepository.getAggregates(id, since24h);

    // Calculate SRE SLO report (target 99.9% over 30d window)
    const sloReport = SloCalculatorService.calculate({
      totalChecks: aggregates.totalChecks,
      healthyChecks: aggregates.healthyChecks,
      degradedChecks: aggregates.degradedChecks,
      downChecks: aggregates.downChecks,
      targetSloPercentage: 99.9,
      windowDays: 30,
      checkIntervalSeconds: endpoint.intervalSeconds,
    });

    return NextResponse.json({
      success: true,
      data: {
        id: endpoint.id,
        name: endpoint.name,
        url: endpoint.url.value,
        method: endpoint.method.value,
        headers: endpoint.headers,
        body: endpoint.body,
        intervalSeconds: endpoint.intervalSeconds,
        timeoutMs: endpoint.timeoutMs,
        expectedStatusCodes: endpoint.expectedStatusCodes,
        assertions: endpoint.assertions.map((a) => a.toJSON()),
        isActive: endpoint.isActive,
        tags: endpoint.tags,
        createdAt: endpoint.createdAt.toISOString(),
        updatedAt: endpoint.updatedAt.toISOString(),
        latestCheck: latestCheck
          ? {
              id: latestCheck.id,
              timestamp: latestCheck.timestamp.toISOString(),
              status: latestCheck.status.value,
              statusCode: latestCheck.statusCode,
              statusText: latestCheck.statusText,
              latency: latestCheck.latency.toJSON(),
              sslInfo: latestCheck.sslInfo,
              failedAssertions: latestCheck.failedAssertions,
              errorMessage: latestCheck.errorMessage,
              region: latestCheck.region,
            }
          : null,
        aggregates,
        sloReport,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al obtener endpoint';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
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

    const body = await request.json();

    // Partial updates
    if (typeof body.isActive === 'boolean') {
      if (body.isActive) {
        endpoint.activate();
      } else {
        endpoint.pause();
      }
    }

    if (body.name !== undefined) endpoint.name = String(body.name).trim();
    if (body.url !== undefined) endpoint.url = new UrlVo(String(body.url));
    if (body.method !== undefined) endpoint.method = new HttpMethodVo(String(body.method));
    if (body.intervalSeconds !== undefined) endpoint.intervalSeconds = Number(body.intervalSeconds);
    if (body.timeoutMs !== undefined) endpoint.timeoutMs = Number(body.timeoutMs);
    if (Array.isArray(body.expectedStatusCodes)) {
      endpoint.expectedStatusCodes = body.expectedStatusCodes.map(Number);
    }
    if (body.headers !== undefined) endpoint.headers = body.headers;
    if (body.body !== undefined) endpoint.body = body.body;
    if (Array.isArray(body.tags)) endpoint.tags = body.tags;
    if (Array.isArray(body.assertions)) {
      endpoint.assertions = body.assertions.map((a: AssertionRule) => new AssertionVo(a));
    }

    endpoint.updatedAt = new Date();
    await endpointRepository.update(endpoint);

    return NextResponse.json({
      success: true,
      message: 'Endpoint actualizado con éxito',
      data: {
        id: endpoint.id,
        name: endpoint.name,
        url: endpoint.url.value,
        isActive: endpoint.isActive,
        updatedAt: endpoint.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al actualizar endpoint';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function DELETE(
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

    await endpointRepository.delete(id);

    return NextResponse.json({
      success: true,
      message: `Endpoint "${endpoint.name}" eliminado correctamente`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al eliminar endpoint';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
