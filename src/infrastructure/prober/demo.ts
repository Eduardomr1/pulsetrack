import { initDatabase } from '../db/migrate-local';
import {
  registerEndpointUseCase,
  executeProbeUseCase,
  healthCheckRepository,
} from '../container';

async function main() {
  console.log('=====================================================');
  console.log(' PULSETRACK OBSERVABILITY PLATFORM - ENGINE VERIFIER ');
  console.log('=====================================================\n');

  // 1. Initialize schema
  await initDatabase();

  // 2. Register sample test endpoints
  console.log('\n[1/3] Registrando endpoints con SLAs y aserciones...');

  const cloudflare = await registerEndpointUseCase.execute({
    name: 'Cloudflare DNS Trace API',
    url: 'https://1.1.1.1/cdn-cgi/trace',
    method: 'GET',
    intervalSeconds: 15,
    timeoutMs: 3000,
    expectedStatusCodes: [200],
    assertions: [
      {
        target: 'latency_ms',
        operator: 'less_than',
        expectedValue: 800,
      },
      {
        target: 'body_contains',
        operator: 'contains',
        expectedValue: 'fl=',
      },
    ],
    tags: ['dns', 'cdn', 'core-infra'],
  });

  const googleDns = await registerEndpointUseCase.execute({
    name: 'Google Public DNS JSON API',
    url: 'https://dns.google/resolve?name=example.com&type=A',
    method: 'GET',
    intervalSeconds: 20,
    timeoutMs: 3000,
    expectedStatusCodes: [200],
    assertions: [
      {
        target: 'latency_ms',
        operator: 'less_than',
        expectedValue: 1000,
      },
      {
        target: 'header',
        property: 'content-type',
        operator: 'contains',
        expectedValue: 'application/x-javascript',
      },
    ],
    tags: ['dns', 'google', 'external'],
  });

  console.log(`✓ Endpoint registrado: ${cloudflare.name} (ID: ${cloudflare.id})`);
  console.log(`✓ Endpoint registrado: ${googleDns.name} (ID: ${googleDns.id})`);

  // 3. Execute High-Precision Probes
  console.log('\n[2/3] Ejecutando sondeo de salud con telemetría de socket detallada...');

  const endpoints = [cloudflare, googleDns];

  for (const ep of endpoints) {
    console.log(`\n-----------------------------------------------------`);
    console.log(`>>> SONDANDO: ${ep.name} [${ep.method.value} ${ep.url.value}]`);
    console.log(`-----------------------------------------------------`);

    const result = await executeProbeUseCase.execute({ endpoint: ep });

    console.log(`Estado:       [${result.status.value}] (HTTP ${result.statusCode ?? 'N/A'} ${result.statusText ?? ''})`);
    console.log(`Región:       ${result.region}`);
    console.log(`Timestamp:    ${result.timestamp.toISOString()}`);
    console.log('\n--- DESGLOSE DE LATENCIA (RED Telemetry Phase Timing) ---');
    console.log(`  1. DNS Lookup:        ${result.latency.dnsLookupMs.toFixed(2)} ms`);
    console.log(`  2. TCP Handshake:     ${result.latency.tcpConnectMs.toFixed(2)} ms`);
    console.log(`  3. TLS Negotiation:   ${result.latency.tlsHandshakeMs.toFixed(2)} ms`);
    console.log(`  4. TTFB (Server):     ${result.latency.ttfbMs.toFixed(2)} ms`);
    console.log(`  5. Content Transfer:  ${result.latency.contentTransferMs.toFixed(2)} ms`);
    console.log(`  ---------------------------------------------------`);
    console.log(`  TOTAL LATENCY:        ${result.latency.totalMs.toFixed(2)} ms`);

    if (result.sslInfo) {
      console.log('\n--- TELEMETRÍA SSL / TLS ---');
      console.log(`  Emisor:            ${result.sslInfo.issuer}`);
      console.log(`  Expira:            ${result.sslInfo.validTo}`);
      console.log(`  Días Restantes:    ${result.sslInfo.daysRemaining} días`);
      console.log(`  Válido:            ${result.sslInfo.valid ? 'SÍ' : 'NO'}`);
    }

    if (result.failedAssertions.length > 0) {
      console.log('\n--- FALLOS DE ASERCIÓN / ALERTAS ---');
      result.failedAssertions.forEach((f) => console.log(`  ⚠️  ${f}`));
    } else {
      console.log('\n✓ Todas las aserciones de SLA pasaron satisfactoriamente.');
    }
  }

  // 4. Query Aggregates from Drizzle DB
  console.log('\n[3/3] Consultando métricas agregadas desde Drizzle ORM...');
  for (const ep of endpoints) {
    const aggregates = await healthCheckRepository.getAggregates(ep.id, new Date(Date.now() - 3600 * 1000));
    console.log(`\nEndpoint: ${ep.name}`);
    console.log(`  Uptime 1h:          ${aggregates.uptimePercentage}%`);
    console.log(`  Muestras totales:   ${aggregates.totalChecks}`);
    console.log(`  Latencia Promedio:  ${aggregates.avgLatencyMs} ms`);
    console.log(`  Latencia p50:       ${aggregates.p50LatencyMs} ms`);
    console.log(`  Latencia p95:       ${aggregates.p95LatencyMs} ms`);
    console.log(`  Latencia p99:       ${aggregates.p99LatencyMs} ms`);
  }

  console.log('\n=====================================================');
  console.log(' PRUEBA DE ARQUITECTURA COMPLETADA CON ÉXITO ');
  console.log('=====================================================\n');
}

void main().catch((err) => {
  console.error('Error fatal durante la prueba:', err);
  process.exit(1);
});
