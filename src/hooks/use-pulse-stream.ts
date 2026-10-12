'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { HealthCheckResult, SslInfo } from '@/core/domain/entities/health-check.entity';
import { HealthStatusVo } from '@/core/domain/value-objects/health-status.vo';
import { LatencyBreakdownVo } from '@/core/domain/value-objects/latency-breakdown.vo';

export interface UsePulseStreamOptions {
  url?: string;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  enabled?: boolean;
}

export interface UsePulseStreamReturn {
  isConnected: boolean;
  latestPulse: HealthCheckResult | null;
  activeIncidentsCount: number;
}

function deserializeHealthCheckResult(raw: unknown): HealthCheckResult | null {
  if (!raw || typeof raw !== 'object') return null;

  const rawObj = raw as Record<string, unknown>;
  const item =
    rawObj.result && typeof rawObj.result === 'object'
      ? (rawObj.result as Record<string, unknown>)
      : rawObj;

  if (typeof item.id !== 'string' || typeof item.endpointId !== 'string') {
    return null;
  }

  const rawStatus =
    typeof item.status === 'string'
      ? item.status
      : typeof (item.status as { value?: unknown })?.value === 'string'
        ? (item.status as { value: string }).value
        : 'UNKNOWN';

  const rawLatency =
    item.latency && typeof item.latency === 'object'
      ? (item.latency as Record<string, unknown>)
      : {};

  const latency = new LatencyBreakdownVo({
    dnsLookupMs: Number(rawLatency.dnsLookupMs ?? 0),
    tcpConnectMs: Number(rawLatency.tcpConnectMs ?? 0),
    tlsHandshakeMs: Number(rawLatency.tlsHandshakeMs ?? 0),
    ttfbMs: Number(rawLatency.ttfbMs ?? 0),
    contentTransferMs: Number(rawLatency.contentTransferMs ?? 0),
    totalMs: Number(rawLatency.totalMs ?? 0),
  });

  return new HealthCheckResult({
    id: String(item.id),
    endpointId: String(item.endpointId),
    timestamp: item.timestamp ? new Date(item.timestamp as string | number) : new Date(),
    status: HealthStatusVo.fromString(rawStatus),
    statusCode: typeof item.statusCode === 'number' ? item.statusCode : null,
    statusText: typeof item.statusText === 'string' ? item.statusText : null,
    latency,
    sslInfo: (item.sslInfo as SslInfo | null | undefined) ?? null,
    errorMessage: typeof item.errorMessage === 'string' ? item.errorMessage : null,
    failedAssertions: Array.isArray(item.failedAssertions)
      ? item.failedAssertions.map(String)
      : [],
    responseHeaders:
      typeof item.responseHeaders === 'object' && item.responseHeaders !== null
        ? (item.responseHeaders as Record<string, string>)
        : {},
    region: typeof item.region === 'string' ? item.region : 'primary',
  });
}

export function usePulseStream(options: UsePulseStreamOptions = {}): UsePulseStreamReturn {
  const {
    url = '/api/sse/pulse',
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    enabled = true,
  } = options;

  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [latestPulse, setLatestPulse] = useState<HealthCheckResult | null>(null);
  const [activeIncidentsCount, setActiveIncidentsCount] = useState<number>(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isUnmountedRef = useRef<boolean>(false);
  const activeIncidentIdsRef = useRef<Set<string>>(new Set());

  const connect = useCallback(() => {
    if (isUnmountedRef.current || !enabled) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (isUnmountedRef.current) return;
        setIsConnected(true);
        retryCountRef.current = 0;
      };

      es.onerror = () => {
        if (isUnmountedRef.current) return;
        setIsConnected(false);
        es.close();
        eventSourceRef.current = null;

        // Exponential backoff with ceiling
        const attempt = retryCountRef.current;
        const delay = Math.min(
          initialDelayMs * Math.pow(backoffMultiplier, attempt),
          maxDelayMs
        );
        retryCountRef.current += 1;

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };

      const handleProbeResult = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data);
          const pulse = deserializeHealthCheckResult(parsed);
          if (pulse) {
            setLatestPulse(pulse);
          }
        } catch (err) {
          console.error('[usePulseStream] Error parsing probe result event:', err);
        }
      };

      const handleIncident = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data) as Record<string, unknown>;
          const incident = parsed.incident as Record<string, unknown> | undefined;
          const incidentId = typeof incident?.id === 'string' ? incident.id : undefined;
          const incidentType = parsed.type as string | undefined;

          if (incidentId) {
            if (incidentType === 'RESOLVED' || incident?.status === 'RESOLVED') {
              activeIncidentIdsRef.current.delete(incidentId);
            } else {
              activeIncidentIdsRef.current.add(incidentId);
            }
          }

          if (typeof parsed.activeIncidentsCount === 'number') {
            setActiveIncidentsCount(parsed.activeIncidentsCount);
          } else {
            setActiveIncidentsCount(activeIncidentIdsRef.current.size);
          }
        } catch (err) {
          console.error('[usePulseStream] Error parsing incident event:', err);
        }
      };

      const handleInit = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data) as Record<string, unknown>;
          if (typeof parsed.activeIncidentsCount === 'number') {
            setActiveIncidentsCount(parsed.activeIncidentsCount);
          }
        } catch (err) {
          console.error('[usePulseStream] Error parsing init event:', err);
        }
      };

      es.addEventListener('telemetry.probe_result', handleProbeResult);
      es.addEventListener('telemetry.incident', handleIncident);
      es.addEventListener('telemetry.init', handleInit);

      // Generic handler for fallback / raw messages
      es.onmessage = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed && typeof parsed === 'object') {
            const pulse = deserializeHealthCheckResult(parsed);
            if (pulse) {
              setLatestPulse(pulse);
            }
          }
        } catch {
          // Ignored (heartbeats, comments)
        }
      };
    } catch (err) {
      console.error('[usePulseStream] Error initiating EventSource connection:', err);
      const delay = Math.min(
        initialDelayMs * Math.pow(backoffMultiplier, retryCountRef.current),
        maxDelayMs
      );
      retryCountRef.current += 1;
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    }
  }, [url, initialDelayMs, maxDelayMs, backoffMultiplier, enabled]);

  useEffect(() => {
    isUnmountedRef.current = false;
    if (enabled) {
      connect();
    }

    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsConnected(false);
    };
  }, [connect, enabled]);

  return {
    isConnected,
    latestPulse,
    activeIncidentsCount,
  };
}
