import {
  telemetryEventBus,
  TelemetryProbeResultPayload,
  TelemetryIncidentPayload,
} from '@/infrastructure/events/telemetry-event-bus';
import { incidentRepository } from '@/infrastructure/container';
import { initDatabase } from '@/infrastructure/db/migrate-local';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let isDbReady = false;
async function ensureDb(): Promise<void> {
  if (!isDbReady) {
    try {
      await initDatabase();
      isDbReady = true;
    } catch {
      // Non-fatal if already initialized
    }
  }
}

export async function GET(req: Request): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;

      const cleanup = () => {
        if (isClosed) return;
        isClosed = true;

        clearInterval(heartbeatInterval);
        telemetryEventBus.off('telemetry.probe_result', onProbeResult);
        telemetryEventBus.off('telemetry.incident', onIncident);
        req.signal.removeEventListener('abort', cleanup);

        try {
          controller.close();
        } catch {
          // Stream already closed or errored
        }
      };

      // 1. Keep-alive heartbeat every 15 seconds to prevent proxy / Cloudflare timeouts
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          cleanup();
        }
      }, 15000);

      // 2. Listener for telemetry probe results
      const onProbeResult = (payload: TelemetryProbeResultPayload) => {
        try {
          const serialized = JSON.stringify({
            id: payload.result.id,
            endpointId: payload.result.endpointId,
            timestamp: payload.result.timestamp.toISOString(),
            status: payload.result.status.value,
            statusCode: payload.result.statusCode,
            statusText: payload.result.statusText,
            latency: payload.result.latency.toJSON(),
            sslInfo: payload.result.sslInfo,
            errorMessage: payload.result.errorMessage,
            failedAssertions: payload.result.failedAssertions,
            responseHeaders: payload.result.responseHeaders,
            region: payload.result.region,
            endpoint: {
              id: payload.endpoint.id,
              name: payload.endpoint.name,
              url: payload.endpoint.url.value,
              method: payload.endpoint.method.value,
            },
          });

          controller.enqueue(
            encoder.encode(`event: telemetry.probe_result\ndata: ${serialized}\n\n`)
          );
        } catch {
          cleanup();
        }
      };

      // 3. Listener for incident state changes
      const onIncident = (payload: TelemetryIncidentPayload) => {
        try {
          const serialized = JSON.stringify({
            type: payload.type,
            endpointId: payload.endpointId,
            endpoint: payload.endpoint
              ? {
                  id: payload.endpoint.id,
                  name: payload.endpoint.name,
                  url: payload.endpoint.url.value,
                }
              : undefined,
            incident: {
              id: payload.incident.id,
              endpointId: payload.incident.endpointId,
              status: payload.incident.status,
              severity: payload.incident.severity,
              startedAt: payload.incident.startedAt.toISOString(),
              resolvedAt: payload.incident.resolvedAt?.toISOString() ?? null,
              summary: payload.incident.summary,
              consecutiveFailures: payload.incident.consecutiveFailures,
            },
          });

          controller.enqueue(
            encoder.encode(`event: telemetry.incident\ndata: ${serialized}\n\n`)
          );
        } catch {
          cleanup();
        }
      };

      // Register event listeners
      telemetryEventBus.on('telemetry.probe_result', onProbeResult);
      telemetryEventBus.on('telemetry.incident', onIncident);

      // Handle client-initiated disconnection (abort signal)
      if (req.signal.aborted) {
        cleanup();
        return;
      }
      req.signal.addEventListener('abort', cleanup);

      // Send initial connection acknowledgement and current active incidents count
      try {
        controller.enqueue(encoder.encode(': connected\n\n'));

        void (async () => {
          try {
            await ensureDb();
            const activeCount = await incidentRepository.countActive();
            if (!isClosed) {
              controller.enqueue(
                encoder.encode(
                  `event: telemetry.init\ndata: ${JSON.stringify({
                    activeIncidentsCount: activeCount,
                    timestamp: new Date().toISOString(),
                  })}\n\n`
                )
              );
            }
          } catch {
            // Non-critical if initialization data cannot be fetched
          }
        })();
      } catch {
        cleanup();
      }
    },
    cancel() {
      // Stream consumer cancelled the stream
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
