import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { performance } from 'node:perf_hooks';
import { LatencyBreakdownVo } from '../../core/domain/value-objects/latency-breakdown.vo';
import { SslInfo } from '../../core/domain/entities/health-check.entity';

export interface RawProbeResult {
  statusCode: number | null;
  statusText: string | null;
  responseHeaders: Record<string, string>;
  body: string;
  latency: LatencyBreakdownVo;
  sslInfo: SslInfo | null;
  errorMessage: string | null;
}

export interface TelemetryProbeOptions {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
  timeoutMs: number;
}

/**
 * High-precision observability probe using low-level Node.js http/https agents and socket event timing.
 * Measures DNS, TCP connect, TLS handshake, TTFB, and transfer duration down to the millisecond.
 */
export async function executeTelemetryProbe(
  options: TelemetryProbeOptions
): Promise<RawProbeResult> {
  const { url: rawUrl, method, headers = {}, body, timeoutMs } = options;
  const parsedUrl = new URL(rawUrl);
  const isHttps = parsedUrl.protocol === 'https:';

  return new Promise<RawProbeResult>((resolve) => {
    const startTime = performance.now();
    let dnsLookupTime = startTime;
    let tcpConnectTime = startTime;
    let tlsHandshakeTime = startTime;
    let ttfbTime = startTime;
    let endTime = startTime;

    let sslInfo: SslInfo | null = null;
    let hasResolved = false;

    const finalize = (result: RawProbeResult) => {
      if (!hasResolved) {
        hasResolved = true;
        resolve(result);
      }
    };

    const requestOptions: http.RequestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: method.toUpperCase(),
      headers: {
        'User-Agent': 'PulseTrack-Observability-Agent/1.0',
        ...headers,
      },
      timeout: timeoutMs,
    };

    const requester = isHttps ? https.request : http.request;

    const req = requester(requestOptions, (res) => {
      ttfbTime = performance.now();
      const chunks: Buffer[] = [];

      // Extract SSL Certificate info if HTTPS
      if (isHttps && req.socket instanceof tls.TLSSocket) {
        const cert = req.socket.getPeerCertificate();
        if (cert && Object.keys(cert).length > 0) {
          const validTo = new Date(cert.valid_to);
          const now = new Date();
          const msRemaining = validTo.getTime() - now.getTime();
          const daysRemaining = Math.max(0, Math.floor(msRemaining / (1000 * 60 * 60 * 24)));

          let issuerName = 'Unknown';
          if (typeof cert.issuer === 'object' && cert.issuer) {
            const rawIssuer = cert.issuer.O ?? cert.issuer.CN;
            issuerName = Array.isArray(rawIssuer) ? rawIssuer.join(', ') : (rawIssuer ?? 'Unknown');
          }

          sslInfo = {
            valid: msRemaining > 0,
            issuer: issuerName,
            validTo: validTo.toISOString(),
            daysRemaining,
          };
        }
      }

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        endTime = performance.now();
        const rawBody = Buffer.concat(chunks).toString('utf-8');

        const dnsLookupMs = Math.max(0, dnsLookupTime - startTime);
        const tcpConnectMs = Math.max(0, tcpConnectTime - dnsLookupTime);
        const tlsHandshakeMs = isHttps ? Math.max(0, tlsHandshakeTime - tcpConnectTime) : 0;
        const ttfbMs = Math.max(0, ttfbTime - (isHttps ? tlsHandshakeTime : tcpConnectTime));
        const contentTransferMs = Math.max(0, endTime - ttfbTime);
        const totalMs = Math.max(0, endTime - startTime);

        const normalizedHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) {
            normalizedHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
          }
        }

        finalize({
          statusCode: res.statusCode ?? null,
          statusText: res.statusMessage ?? null,
          responseHeaders: normalizedHeaders,
          body: rawBody,
          latency: new LatencyBreakdownVo({
            dnsLookupMs,
            tcpConnectMs,
            tlsHandshakeMs,
            ttfbMs,
            contentTransferMs,
            totalMs,
          }),
          sslInfo,
          errorMessage: null,
        });
      });
    });

    // Socket-level observability hooks
    req.on('socket', (socket) => {
      socket.on('lookup', () => {
        dnsLookupTime = performance.now();
      });

      socket.on('connect', () => {
        tcpConnectTime = performance.now();
      });

      socket.on('secureConnect', () => {
        tlsHandshakeTime = performance.now();
      });
    });

    req.on('timeout', () => {
      endTime = performance.now();
      req.destroy(new Error(`Timeout superado después de ${timeoutMs}ms`));
    });

    req.on('error', (err: Error) => {
      endTime = performance.now();
      const elapsed = Math.max(0, endTime - startTime);

      finalize({
        statusCode: null,
        statusText: null,
        responseHeaders: {},
        body: '',
        latency: new LatencyBreakdownVo({
          dnsLookupMs: dnsLookupTime > startTime ? dnsLookupTime - startTime : 0,
          tcpConnectMs: tcpConnectTime > dnsLookupTime ? tcpConnectTime - dnsLookupTime : 0,
          tlsHandshakeMs: tlsHandshakeTime > tcpConnectTime ? tlsHandshakeTime - tcpConnectTime : 0,
          ttfbMs: 0,
          contentTransferMs: 0,
          totalMs: elapsed,
        }),
        sslInfo: null,
        errorMessage: err.message || 'Error de conexión desconocido',
      });
    });

    if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      req.write(body);
    }

    req.end();
  });
}
