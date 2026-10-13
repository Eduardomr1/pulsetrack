import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
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
  errorCode?: string | null;
  resolvedAddress?: string | null;
  contentLength?: number;
}

export interface TelemetryProbeOptions {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
  timeoutMs: number;
  agent?: http.Agent | boolean;
  rejectUnauthorized?: boolean;
}

/**
 * High-precision observability probe using low-level Node.js http/https agents and socket event timing.
 * Measures DNS, TCP connect, TLS handshake, TTFB, and transfer duration down to the millisecond.
 */
export async function executeTelemetryProbe(
  options: TelemetryProbeOptions
): Promise<RawProbeResult> {
  const { url: rawUrl, method, headers = {}, body, timeoutMs } = options;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'URL inválida';
    return {
      statusCode: null,
      statusText: null,
      responseHeaders: {},
      body: '',
      latency: LatencyBreakdownVo.zero(),
      sslInfo: null,
      errorMessage: `URL no válida: ${errorMsg}`,
      errorCode: 'ERR_INVALID_URL',
      resolvedAddress: null,
      contentLength: 0,
    };
  }

  const isHttps = parsedUrl.protocol === 'https:';

  return new Promise<RawProbeResult>((resolve) => {
    const startTime = performance.now();
    let dnsLookupTimestamp: number | null = null;
    let tcpConnectTimestamp: number | null = null;
    let tlsHandshakeTimestamp: number | null = null;
    let ttfbTimestamp: number | null = null;
    let endTimestamp: number | null = null;

    let resolvedAddress: string | null = null;
    if (net.isIP(parsedUrl.hostname)) {
      resolvedAddress = parsedUrl.hostname;
    }

    let sslInfo: SslInfo | null = null;
    let hasResolved = false;

    const finalize = (result: RawProbeResult) => {
      if (!hasResolved) {
        hasResolved = true;
        resolve(result);
      }
    };

    const requestHeaders: Record<string, string> = {
      'User-Agent': 'PulseTrack-Observability-Agent/1.0',
      'Accept': '*/*',
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
      if (!requestHeaders['Content-Length'] && !requestHeaders['content-length']) {
        requestHeaders['Content-Length'] = Buffer.byteLength(body).toString();
      }
    }

    const requestOptions: https.RequestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`,
      method: method.toUpperCase(),
      headers: requestHeaders,
      timeout: timeoutMs,
      agent: options.agent !== undefined ? options.agent : false,
      rejectUnauthorized: options.rejectUnauthorized !== undefined ? options.rejectUnauthorized : false,
    };

    const requester = isHttps ? https.request : http.request;

    const req = requester(requestOptions, (res) => {
      ttfbTimestamp = performance.now();
      const chunks: Buffer[] = [];

      // Extract SSL Certificate info if HTTPS
      if (isHttps && req.socket instanceof tls.TLSSocket) {
        try {
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
        } catch {
          // Ignore certificate inspection error if socket closed
        }
      }

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        endTimestamp = performance.now();
        const rawBody = Buffer.concat(chunks).toString('utf-8');

        // Detailed phase duration calculation
        const dnsLookupMs = dnsLookupTimestamp !== null
          ? Math.max(0, dnsLookupTimestamp - startTime)
          : 0;

        const connectStart = dnsLookupTimestamp ?? startTime;
        const tcpConnectMs = tcpConnectTimestamp !== null
          ? Math.max(0, tcpConnectTimestamp - connectStart)
          : 0;

        const tlsStart = tcpConnectTimestamp ?? connectStart;
        const tlsHandshakeMs = (isHttps && tlsHandshakeTimestamp !== null)
          ? Math.max(0, tlsHandshakeTimestamp - tlsStart)
          : 0;

        const requestSentTime = isHttps
          ? (tlsHandshakeTimestamp ?? tcpConnectTimestamp ?? startTime)
          : (tcpConnectTimestamp ?? dnsLookupTimestamp ?? startTime);

        const ttfbMs = ttfbTimestamp !== null
          ? Math.max(0, ttfbTimestamp - requestSentTime)
          : 0;

        const contentTransferMs = (ttfbTimestamp !== null && endTimestamp !== null)
          ? Math.max(0, endTimestamp - ttfbTimestamp)
          : 0;

        const totalMs = Math.max(0, endTimestamp - startTime);

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
          errorCode: null,
          resolvedAddress,
          contentLength: Buffer.byteLength(rawBody),
        });
      });
    });

    // Socket-level observability hooks
    req.on('socket', (socket) => {
      if (socket.connecting) {
        socket.once('lookup', (_err, address) => {
          dnsLookupTimestamp = performance.now();
          if (address) {
            resolvedAddress = address;
          }
        });

        socket.once('connect', () => {
          tcpConnectTimestamp = performance.now();
        });

        socket.once('secureConnect', () => {
          tlsHandshakeTimestamp = performance.now();
        });
      } else {
        // Socket already established (e.g. mock or pre-connected socket)
        tcpConnectTimestamp = performance.now();
        if (isHttps) {
          tlsHandshakeTimestamp = tcpConnectTimestamp;
        }
      }
    });

    req.on('timeout', () => {
      endTimestamp = performance.now();
      const timeoutErr = new Error(`Timeout superado después de ${timeoutMs}ms`) as NodeJS.ErrnoException;
      timeoutErr.code = 'ETIMEDOUT';
      req.destroy(timeoutErr);
    });

    req.on('error', (err: Error) => {
      endTimestamp = performance.now();
      const elapsed = Math.max(0, endTimestamp - startTime);
      const nodeErr = err as NodeJS.ErrnoException;
      const errorCode = nodeErr.code ?? null;

      const dnsLookupMs = dnsLookupTimestamp !== null
        ? Math.max(0, dnsLookupTimestamp - startTime)
        : (errorCode === 'ENOTFOUND' ? elapsed : 0);

      const tcpConnectMs = (tcpConnectTimestamp !== null && dnsLookupTimestamp !== null)
        ? Math.max(0, tcpConnectTimestamp - dnsLookupTimestamp)
        : (errorCode === 'ECONNREFUSED' ? Math.max(0, elapsed - dnsLookupMs) : 0);

      const tlsHandshakeMs = (isHttps && tlsHandshakeTimestamp !== null && tcpConnectTimestamp !== null)
        ? Math.max(0, tlsHandshakeTimestamp - tcpConnectTimestamp)
        : 0;

      finalize({
        statusCode: null,
        statusText: null,
        responseHeaders: {},
        body: '',
        latency: new LatencyBreakdownVo({
          dnsLookupMs,
          tcpConnectMs,
          tlsHandshakeMs,
          ttfbMs: 0,
          contentTransferMs: 0,
          totalMs: elapsed,
        }),
        sslInfo: null,
        errorMessage: err.message || 'Error de conexión desconocido',
        errorCode,
        resolvedAddress,
        contentLength: 0,
      });
    });

    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
      req.write(body);
    }

    req.end();
  });
}
