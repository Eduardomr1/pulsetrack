import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { executeTelemetryProbe } from './http-telemetry-agent';

describe('HTTP Telemetry Agent (executeTelemetryProbe)', () => {
  let server: http.Server;
  let serverPort: number;
  let serverUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);

      if (url.pathname === '/fast') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Pulse-Node': 'test-node-1',
        });
        res.end(JSON.stringify({ status: 'ok', time: Date.now() }));
      } else if (url.pathname === '/slow') {
        // Deliberate 80ms delay to verify latency breakdown and TTFB
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('slow response data');
        }, 80);
      } else if (url.pathname === '/error-500') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      } else if (url.pathname === '/error-503') {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
      } else if (url.pathname === '/echo-method') {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-Echo-Method': req.method,
          });
          res.end(JSON.stringify({ method: req.method, body }));
        });
      } else if (url.pathname === '/hang') {
        // Do not respond at all to test client timeout
        // (will be cleaned up when request destroys)
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        serverPort = addr.port;
        serverUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('debe medir con precisión una respuesta 200 OK rápida (TTFB, headers, body, breakdown)', async () => {
    const result = await executeTelemetryProbe({
      url: `${serverUrl}/fast`,
      method: 'GET',
      timeoutMs: 3000,
    });

    expect(result.statusCode).toBe(200);
    expect(result.statusText).toBe('OK');
    expect(result.errorMessage).toBeNull();
    expect(result.errorCode).toBeNull();
    expect(result.body).toContain('status');
    expect(result.responseHeaders['x-pulse-node']).toBe('test-node-1');
    expect(result.responseHeaders['content-type']).toBe('application/json');

    // Telemetry latency breakdown
    expect(result.latency.totalMs).toBeGreaterThan(0);
    expect(result.latency.ttfbMs).toBeGreaterThanOrEqual(0);
    expect(result.latency.contentTransferMs).toBeGreaterThanOrEqual(0);
    expect(result.resolvedAddress).toBe('127.0.0.1');
    expect(result.contentLength).toBeGreaterThan(0);
  });

  it('debe registrar el retraso en TTFB y tiempo total ante un endpoint lento', async () => {
    const result = await executeTelemetryProbe({
      url: `${serverUrl}/slow`,
      method: 'GET',
      timeoutMs: 3000,
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('slow response data');
    // Deliberate 80ms delay should be reflected in TTFB and totalMs
    expect(result.latency.ttfbMs).toBeGreaterThanOrEqual(60);
    expect(result.latency.totalMs).toBeGreaterThanOrEqual(60);
  });

  it('debe capturar endpoints caídos con código 500 y 503', async () => {
    const result500 = await executeTelemetryProbe({
      url: `${serverUrl}/error-500`,
      method: 'GET',
      timeoutMs: 3000,
    });
    expect(result500.statusCode).toBe(500);
    expect(result500.statusText).toBe('Internal Server Error');
    expect(result500.body).toContain('Internal Server Error');

    const result503 = await executeTelemetryProbe({
      url: `${serverUrl}/error-503`,
      method: 'GET',
      timeoutMs: 3000,
    });
    expect(result503.statusCode).toBe(503);
    expect(result503.statusText).toBe('Service Unavailable');
  });

  it('debe capturar ECONNREFUSED al intentar conectar a un puerto cerrado', async () => {
    // Choose an unused port guaranteed to be closed
    const closedPort = 58941;
    const result = await executeTelemetryProbe({
      url: `http://127.0.0.1:${closedPort}/unreachable`,
      method: 'GET',
      timeoutMs: 1500,
    });

    expect(result.statusCode).toBeNull();
    expect(result.statusText).toBeNull();
    expect(result.errorCode).toBe('ECONNREFUSED');
    expect(result.errorMessage).toBeDefined();
    expect(result.errorMessage).toContain('ECONNREFUSED');
    expect(result.latency.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('debe manejar timeout adecuadamente con código ETIMEDOUT', async () => {
    const result = await executeTelemetryProbe({
      url: `${serverUrl}/hang`,
      method: 'GET',
      timeoutMs: 80, // Very low timeout
    });

    expect(result.statusCode).toBeNull();
    expect(result.errorCode).toBe('ETIMEDOUT');
    expect(result.errorMessage).toContain('Timeout');
    expect(result.latency.totalMs).toBeGreaterThanOrEqual(70);
  });

  it('debe enviar payload y cabeceras personalizadas en peticiones POST', async () => {
    const payload = JSON.stringify({ user: 'sre-engineer', metric: 'cpu_usage' });
    const result = await executeTelemetryProbe({
      url: `${serverUrl}/echo-method`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Trace-Id': 'trace-12345',
      },
      body: payload,
      timeoutMs: 3000,
    });

    expect(result.statusCode).toBe(200);
    expect(result.responseHeaders['x-echo-method']).toBe('POST');
    const parsedBody = JSON.parse(result.body);
    expect(parsedBody.method).toBe('POST');
    expect(parsedBody.body).toBe(payload);
  });

  it('debe manejar URLs inválidas sin lanzar excepciones no controladas', async () => {
    const result = await executeTelemetryProbe({
      url: 'not-a-valid-url',
      method: 'GET',
      timeoutMs: 1000,
    });

    expect(result.statusCode).toBeNull();
    expect(result.errorCode).toBe('ERR_INVALID_URL');
    expect(result.errorMessage).toContain('URL no válida');
  });
});
