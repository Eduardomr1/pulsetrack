import { NextResponse } from 'next/server';
import { healthCheckRepository } from '@/infrastructure/container';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: endpointId } = await params;
    const { searchParams } = new URL(req.url);
    const timeframe = searchParams.get('timeframe') ?? '24h';

    let durationMs = 24 * 3600 * 1000;
    let bucketCount = 24; // 1 bucket per hour for 24h

    if (timeframe === '1h') {
      durationMs = 3600 * 1000;
      bucketCount = 30; // 2 minutes per bucket
    } else if (timeframe === '7d') {
      durationMs = 7 * 24 * 3600 * 1000;
      bucketCount = 28; // 6 hours per bucket
    } else if (timeframe === '30d') {
      durationMs = 30 * 24 * 3600 * 1000;
      bucketCount = 30; // 1 day per bucket
    }

    const to = new Date();
    const from = new Date(to.getTime() - durationMs);

    const checks = await healthCheckRepository.findHistory({
      endpointId,
      from,
      to,
      limit: 1000,
    });

    const bucketDurationMs = durationMs / bucketCount;
    const buckets: Array<{
      bucketIndex: number;
      startTime: string;
      endTime: string;
      status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'NONE';
      sampleCount: number;
      uptimePercentage: number;
      avgLatencyMs: number;
      minLatencyMs: number;
      maxLatencyMs: number;
      p95LatencyMs: number;
    }> = [];

    // Reverse to chronological order (oldest to newest)
    const chronological = [...checks].reverse();

    for (let i = 0; i < bucketCount; i++) {
      const bStart = from.getTime() + i * bucketDurationMs;
      const bEnd = bStart + bucketDurationMs;

      const samplesInBucket = chronological.filter((c) => {
        const t = c.timestamp.getTime();
        return t >= bStart && t < bEnd;
      });

      if (samplesInBucket.length === 0) {
        buckets.push({
          bucketIndex: i,
          startTime: new Date(bStart).toISOString(),
          endTime: new Date(bEnd).toISOString(),
          status: 'NONE',
          sampleCount: 0,
          uptimePercentage: 100,
          avgLatencyMs: 0,
          minLatencyMs: 0,
          maxLatencyMs: 0,
          p95LatencyMs: 0,
        });
        continue;
      }

      let healthyCount = 0;
      let degradedCount = 0;
      let downCount = 0;
      const latencies: number[] = [];

      for (const s of samplesInBucket) {
        if (s.status.isHealthy()) healthyCount++;
        else if (s.status.isDegraded()) degradedCount++;
        else downCount++;

        latencies.push(s.latency.totalMs);
      }

      latencies.sort((a, b) => a - b);
      const sumLatency = latencies.reduce((acc, curr) => acc + curr, 0);
      const avgLatencyMs = Math.round((sumLatency / latencies.length) * 100) / 100;
      const minLatencyMs = latencies[0] ?? 0;
      const maxLatencyMs = latencies[latencies.length - 1] ?? 0;
      const p95Idx = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
      const p95LatencyMs = latencies[p95Idx] ?? 0;

      const available = healthyCount + degradedCount;
      const uptimePercentage = Math.round((available / samplesInBucket.length) * 10000) / 100;

      let dominantStatus: 'HEALTHY' | 'DEGRADED' | 'DOWN' = 'HEALTHY';
      if (downCount > 0) dominantStatus = 'DOWN';
      else if (degradedCount > 0) dominantStatus = 'DEGRADED';

      buckets.push({
        bucketIndex: i,
        startTime: new Date(bStart).toISOString(),
        endTime: new Date(bEnd).toISOString(),
        status: dominantStatus,
        sampleCount: samplesInBucket.length,
        uptimePercentage,
        avgLatencyMs,
        minLatencyMs,
        maxLatencyMs,
        p95LatencyMs,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        endpointId,
        timeframe,
        totalSamples: checks.length,
        buckets,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al obtener historial';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
