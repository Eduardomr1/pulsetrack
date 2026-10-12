import { eq, desc, and, gte, lte } from 'drizzle-orm';
import { Database } from '../drizzle.client';
import { healthChecksTable, HealthCheckRow } from '../schema/health-checks.schema';
import {
  IHealthCheckRepository,
  TimeSeriesFilter,
  EndpointAggregates,
} from '../../../core/domain/ports/health-check.repository';
import { HealthCheckResult, SslInfo } from '../../../core/domain/entities/health-check.entity';
import { HealthStatusVo } from '../../../core/domain/value-objects/health-status.vo';
import { LatencyBreakdownVo } from '../../../core/domain/value-objects/latency-breakdown.vo';

export class DrizzleHealthCheckRepository implements IHealthCheckRepository {
  constructor(private readonly db: Database) {}

  private toDomain(row: HealthCheckRow): HealthCheckResult {
    const rawSsl = row.sslInfo ? (JSON.parse(row.sslInfo) as SslInfo) : null;
    const rawFailures = JSON.parse(row.failedAssertions || '[]') as string[];
    const rawHeaders = row.responseHeaders ? (JSON.parse(row.responseHeaders) as Record<string, string>) : {};

    return new HealthCheckResult({
      id: row.id,
      endpointId: row.endpointId,
      timestamp: row.timestamp,
      status: HealthStatusVo.fromString(row.status),
      statusCode: row.statusCode,
      statusText: row.statusText,
      latency: new LatencyBreakdownVo({
        dnsLookupMs: row.dnsLookupMs,
        tcpConnectMs: row.tcpConnectMs,
        tlsHandshakeMs: row.tlsHandshakeMs,
        ttfbMs: row.ttfbMs,
        contentTransferMs: row.contentTransferMs,
        totalMs: row.totalMs,
      }),
      sslInfo: rawSsl,
      errorMessage: row.errorMessage,
      failedAssertions: rawFailures,
      responseHeaders: rawHeaders,
      region: row.region,
    });
  }

  public async save(result: HealthCheckResult): Promise<void> {
    await this.db.insert(healthChecksTable).values({
      id: result.id,
      endpointId: result.endpointId,
      timestamp: result.timestamp,
      status: result.status.value,
      statusCode: result.statusCode,
      statusText: result.statusText,
      dnsLookupMs: result.latency.dnsLookupMs,
      tcpConnectMs: result.latency.tcpConnectMs,
      tlsHandshakeMs: result.latency.tlsHandshakeMs,
      ttfbMs: result.latency.ttfbMs,
      contentTransferMs: result.latency.contentTransferMs,
      totalMs: result.latency.totalMs,
      sslInfo: result.sslInfo ? JSON.stringify(result.sslInfo) : null,
      errorMessage: result.errorMessage,
      failedAssertions: JSON.stringify(result.failedAssertions),
      responseHeaders: JSON.stringify(result.responseHeaders),
      region: result.region,
    });
  }

  public async findLatestByEndpointId(endpointId: string): Promise<HealthCheckResult | null> {
    const rows = await this.db
      .select()
      .from(healthChecksTable)
      .where(eq(healthChecksTable.endpointId, endpointId))
      .orderBy(desc(healthChecksTable.timestamp))
      .limit(1);

    const first = rows[0];
    if (!first) return null;
    return this.toDomain(first);
  }

  public async findRecentByEndpointId(
    endpointId: string,
    limit: number = 50
  ): Promise<HealthCheckResult[]> {
    const rows = await this.db
      .select()
      .from(healthChecksTable)
      .where(eq(healthChecksTable.endpointId, endpointId))
      .orderBy(desc(healthChecksTable.timestamp))
      .limit(limit);

    return rows.map((r: HealthCheckRow) => this.toDomain(r));
  }

  public async findHistory(filter: TimeSeriesFilter): Promise<HealthCheckResult[]> {
    const query = this.db
      .select()
      .from(healthChecksTable)
      .where(
        and(
          eq(healthChecksTable.endpointId, filter.endpointId),
          gte(healthChecksTable.timestamp, filter.from),
          lte(healthChecksTable.timestamp, filter.to)
        )
      )
      .orderBy(desc(healthChecksTable.timestamp));

    const rows = filter.limit ? await query.limit(filter.limit) : await query;
    return rows.map((r: HealthCheckRow) => this.toDomain(r));
  }

  public async getAggregates(endpointId: string, since: Date): Promise<EndpointAggregates> {
    const rows = await this.db
      .select()
      .from(healthChecksTable)
      .where(
        and(
          eq(healthChecksTable.endpointId, endpointId),
          gte(healthChecksTable.timestamp, since)
        )
      );

    if (rows.length === 0) {
      return {
        totalChecks: 0,
        healthyChecks: 0,
        degradedChecks: 0,
        downChecks: 0,
        uptimePercentage: 100,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
      };
    }

    let healthy = 0;
    let degraded = 0;
    let down = 0;
    const latencies: number[] = [];

    for (const r of rows) {
      if (r.status === 'HEALTHY') healthy++;
      else if (r.status === 'DEGRADED') degraded++;
      else down++;

      latencies.push(r.totalMs);
    }

    latencies.sort((a, b) => a - b);

    const total = rows.length;
    const available = healthy + degraded;
    const uptimePercentage = Math.round((available / total) * 10000) / 100;
    const sumLatency = latencies.reduce((acc, curr) => acc + curr, 0);
    const avgLatencyMs = Math.round((sumLatency / total) * 100) / 100;

    const getPercentile = (pct: number) => {
      const idx = Math.min(latencies.length - 1, Math.floor((pct / 100) * latencies.length));
      return Math.round((latencies[idx] ?? 0) * 100) / 100;
    };

    return {
      totalChecks: total,
      healthyChecks: healthy,
      degradedChecks: degraded,
      downChecks: down,
      uptimePercentage,
      avgLatencyMs,
      p50LatencyMs: getPercentile(50),
      p95LatencyMs: getPercentile(95),
      p99LatencyMs: getPercentile(99),
    };
  }
}
