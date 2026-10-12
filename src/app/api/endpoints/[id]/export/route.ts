import { NextRequest, NextResponse } from 'next/server';
import { endpointRepository, healthCheckRepository } from '@/infrastructure/container';
import { HealthCheckResult } from '@/core/domain/entities/health-check.entity';

export async function GET(
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

    const { searchParams } = new URL(request.url);
    const format = (searchParams.get('format') ?? 'csv').toLowerCase();
    const limit = Math.min(1000, Math.max(10, Number(searchParams.get('limit') ?? 200)));

    const checks = await healthCheckRepository.findRecentByEndpointId(id, limit);

    if (format === 'json') {
      return NextResponse.json({
        success: true,
        endpoint: {
          id: endpoint.id,
          name: endpoint.name,
          url: endpoint.url.value,
          method: endpoint.method.value,
        },
        sampleCount: checks.length,
        exportedAt: new Date().toISOString(),
        samples: checks.map((c: HealthCheckResult) => ({
          id: c.id,
          timestamp: c.timestamp.toISOString(),
          status: c.status.value,
          statusCode: c.statusCode,
          statusText: c.statusText,
          latency: c.latency.toJSON(),
          sslInfo: c.sslInfo,
          failedAssertions: c.failedAssertions,
          errorMessage: c.errorMessage,
          region: c.region,
        })),
      });
    }

    // Default: CSV Export (RFC 4180 format)
    const headers = [
      'id',
      'timestamp',
      'status',
      'status_code',
      'status_text',
      'total_ms',
      'dns_lookup_ms',
      'tcp_connect_ms',
      'tls_handshake_ms',
      'ttfb_ms',
      'content_transfer_ms',
      'ssl_valid',
      'ssl_issuer',
      'ssl_days_remaining',
      'region',
      'failed_assertions',
      'error_message',
    ];

    const escapeCsv = (val: unknown): string => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvLines = [headers.join(',')];

    for (const c of checks) {
      const row = [
        escapeCsv(c.id),
        escapeCsv(c.timestamp.toISOString()),
        escapeCsv(c.status.value),
        escapeCsv(c.statusCode ?? ''),
        escapeCsv(c.statusText ?? ''),
        escapeCsv(c.latency.totalMs.toFixed(2)),
        escapeCsv(c.latency.dnsLookupMs.toFixed(2)),
        escapeCsv(c.latency.tcpConnectMs.toFixed(2)),
        escapeCsv(c.latency.tlsHandshakeMs.toFixed(2)),
        escapeCsv(c.latency.ttfbMs.toFixed(2)),
        escapeCsv(c.latency.contentTransferMs.toFixed(2)),
        escapeCsv(c.sslInfo ? (c.sslInfo.valid ? 'true' : 'false') : ''),
        escapeCsv(c.sslInfo?.issuer ?? ''),
        escapeCsv(c.sslInfo?.daysRemaining ?? ''),
        escapeCsv(c.region),
        escapeCsv(c.failedAssertions.join('; ')),
        escapeCsv(c.errorMessage ?? ''),
      ];
      csvLines.push(row.join(','));
    }

    const csvContent = csvLines.join('\r\n');
    const sanitizedName = endpoint.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const filename = `pulsetrack-${sanitizedName}-${Date.now()}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al exportar telemetría';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
