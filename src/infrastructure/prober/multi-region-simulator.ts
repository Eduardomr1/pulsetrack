import { Endpoint } from '../../core/domain/entities/endpoint.entity';
import { LatencyBreakdownVo } from '../../core/domain/value-objects/latency-breakdown.vo';
import { RawProbeResult } from './http-telemetry-agent';
import { HttpProberEngine } from './http-prober.engine';
import { AssertionEvaluator } from './assertion-evaluator';

export interface RegionalNodeConfig {
  code: 'us-east-1' | 'eu-central-1' | 'ap-southeast-1' | 'sa-east-1';
  name: string;
  location: string;
  flag: string;
  propagationRttMs: number; // Base roundtrip time delta in ms from baseline
  jitterVarianceMs: number;
}

export const REGIONAL_NODES: RegionalNodeConfig[] = [
  {
    code: 'us-east-1',
    name: 'US East (N. Virginia)',
    location: 'North America Edge',
    flag: '🇺🇸',
    propagationRttMs: 0, // Baseline local origin
    jitterVarianceMs: 4,
  },
  {
    code: 'eu-central-1',
    name: 'Europe (Frankfurt)',
    location: 'Europe Central Edge',
    flag: '🇩🇪',
    propagationRttMs: 82, // Transatlantic fiber optic delay
    jitterVarianceMs: 9,
  },
  {
    code: 'ap-southeast-1',
    name: 'Asia Pacific (Singapore)',
    location: 'Southeast Asia Edge',
    flag: '🇸🇬',
    propagationRttMs: 195, // Transpacific submarine cable delay
    jitterVarianceMs: 14,
  },
  {
    code: 'sa-east-1',
    name: 'South America (São Paulo)',
    location: 'Latin America Edge',
    flag: '🇧🇷',
    propagationRttMs: 125, // South American routing gateway delay
    jitterVarianceMs: 11,
  },
];

export interface RegionProbeResult {
  regionCode: string;
  regionName: string;
  location: string;
  flag: string;
  statusCode: number | null;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  latency: {
    dnsLookupMs: number;
    tcpConnectMs: number;
    tlsHandshakeMs: number;
    ttfbMs: number;
    contentTransferMs: number;
    totalMs: number;
  };
  deltaFromBaselineMs: number;
  errorMessage: string | null;
}

export class MultiRegionSimulatorService {
  constructor(private readonly proberEngine: HttpProberEngine) {}

  /**
   * Executes a synchronized multi-region probe across 4 global edge nodes.
   */
  public async probeAllRegions(endpoint: Endpoint): Promise<RegionProbeResult[]> {
    // 1. Run the real socket probe from the primary prober
    const baselineRaw = await this.proberEngine.probeRaw(endpoint);

    // 2. Synthesize edge metrics for each geographical node
    const results: RegionProbeResult[] = REGIONAL_NODES.map((node) => {
      // If primary probe failed with connection error, all regions reflect failure
      if (baselineRaw.statusCode === null) {
        return {
          regionCode: node.code,
          regionName: node.name,
          location: node.location,
          flag: node.flag,
          statusCode: null,
          status: 'DOWN',
          latency: {
            dnsLookupMs: 0,
            tcpConnectMs: 0,
            tlsHandshakeMs: 0,
            ttfbMs: 0,
            contentTransferMs: 0,
            totalMs: 0,
          },
          deltaFromBaselineMs: 0,
          errorMessage: baselineRaw.errorMessage ?? 'Conexión rechazada o timeout',
        };
      }

      // Compute regional latency with realistic jitter
      const jitter = (Math.random() - 0.5) * 2 * node.jitterVarianceMs;
      const regionalRtt = Math.max(0, node.propagationRttMs + jitter);

      const base = baselineRaw.latency;
      const dnsLookupMs = Number((base.dnsLookupMs + (node.code === 'us-east-1' ? 0 : 4.5 + Math.random() * 3)).toFixed(2));
      const tcpConnectMs = Number((base.tcpConnectMs + (node.code === 'us-east-1' ? 0 : regionalRtt * 0.45)).toFixed(2));
      const tlsHandshakeMs = Number((base.tlsHandshakeMs + (node.code === 'us-east-1' ? 0 : regionalRtt * 0.35)).toFixed(2));
      const ttfbMs = Number((base.ttfbMs + (node.code === 'us-east-1' ? 0 : regionalRtt * 0.2)).toFixed(2));
      const contentTransferMs = base.contentTransferMs;
      const totalMs = Number((dnsLookupMs + tcpConnectMs + tlsHandshakeMs + ttfbMs + contentTransferMs).toFixed(2));

      // Synthetic RawProbe for assertion evaluation
      const regionalProbe: RawProbeResult = {
        ...baselineRaw,
        latency: new LatencyBreakdownVo({
          dnsLookupMs,
          tcpConnectMs,
          tlsHandshakeMs,
          ttfbMs,
          contentTransferMs,
          totalMs,
        }),
      };

      // Evaluate SLA assertions with regional latency
      const evalResult = AssertionEvaluator.evaluate(
        endpoint.assertions,
        endpoint.expectedStatusCodes,
        regionalProbe
      );

      let status: 'HEALTHY' | 'DEGRADED' | 'DOWN' = 'HEALTHY';
      if (!evalResult.passed) {
        // If status code matches but latency SLA failed -> DEGRADED
        const isOnlyLatencyFailure = evalResult.failures.every((f) => f.includes('Latencia'));
        status = isOnlyLatencyFailure ? 'DEGRADED' : 'DOWN';
      }

      return {
        regionCode: node.code,
        regionName: node.name,
        location: node.location,
        flag: node.flag,
        statusCode: baselineRaw.statusCode,
        status,
        latency: {
          dnsLookupMs,
          tcpConnectMs,
          tlsHandshakeMs,
          ttfbMs,
          contentTransferMs,
          totalMs,
        },
        deltaFromBaselineMs: Number((totalMs - baselineRaw.latency.totalMs).toFixed(1)),
        errorMessage: evalResult.failures.length > 0 ? evalResult.failures.join('; ') : null,
      };
    });

    return results;
  }
}
