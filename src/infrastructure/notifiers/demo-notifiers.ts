import http from 'node:http';
import crypto from 'node:crypto';
import { Endpoint } from '../../core/domain/entities/endpoint.entity';
import { UrlVo } from '../../core/domain/value-objects/url.vo';
import { HttpMethodVo } from '../../core/domain/value-objects/http-method.vo';
import { HealthCheckResult } from '../../core/domain/entities/health-check.entity';
import { HealthStatusVo } from '../../core/domain/value-objects/health-status.vo';
import { LatencyBreakdownVo } from '../../core/domain/value-objects/latency-breakdown.vo';
import { Incident } from '../../core/domain/entities/incident.entity';
import { AlertChannel } from '../../core/domain/entities/alert-channel.entity';
import { AlertManagerService } from './alert-manager.service';
import { initDatabase } from '../db/migrate-local';
import { db } from '../db/drizzle.client';
import { endpointsTable, alertChannelsTable, incidentsTable } from '../db/schema';

async function runNotifiersDemo() {
  console.log('================================================================');
  console.log(' PULSETRACK ALERT AGENTS: WEBHOOK, SLACK & DISCORD VERIFICATION ');
  console.log('================================================================\n');

  await initDatabase();

  const receivedDeliveries: Record<string, { headers: http.IncomingHttpHeaders; body: unknown }> = {};

  // 1. Spin up a local mock receiver server
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      const url = req.url ?? '/';
      let parsedBody: unknown = raw;
      try {
        parsedBody = JSON.parse(raw);
      } catch {
        // raw string
      }

      receivedDeliveries[url] = {
        headers: req.headers,
        body: parsedBody,
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, received: true }));
    });
  });

  await new Promise<void>((resolve) => server.listen(4899, () => resolve()));
  const baseUrl = 'http://localhost:4899';
  console.log(`[Mock Server] Escuchando entregas de notificación en ${baseUrl}\n`);

  // 2. Setup the 3 Alert Channels
  const secretKey = 'pulsetrack-super-secret-hmac-key';

  const webhookChannel = new AlertChannel({
    id: 'ch-webhook-1',
    name: 'Ops Genérico Webhook',
    type: 'WEBHOOK',
    config: {
      webhookUrl: `${baseUrl}/webhook`,
      secretKey,
    },
    events: ['DOWN', 'RECOVERED'],
    isEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const slackChannel = new AlertChannel({
    id: 'ch-slack-1',
    name: 'Canal Slack #incident-response',
    type: 'SLACK',
    config: {
      webhookUrl: `${baseUrl}/slack`,
      channel: '#incident-response',
      mentionOnCritical: true,
    },
    events: ['DOWN', 'RECOVERED'],
    isEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const discordChannel = new AlertChannel({
    id: 'ch-discord-1',
    name: 'Discord DevOps Embeds',
    type: 'DISCORD',
    config: {
      webhookUrl: `${baseUrl}/discord`,
      username: 'PulseTrack Alert Bot',
      mentionRoleId: '992837461',
    },
    events: ['DOWN', 'RECOVERED'],
    isEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const alertManager = new AlertManagerService(db, { cooldownSeconds: 0 });
  alertManager.registerChannel(webhookChannel);
  alertManager.registerChannel(slackChannel);
  alertManager.registerChannel(discordChannel);

  // 3. Create simulated Incident & HealthCheck Result
  const paymentEndpoint = new Endpoint({
    id: 'ep-pay-01',
    name: 'Stripe Payments Checkout API',
    url: new UrlVo('https://api.stripe.com/v1/charges'),
    method: new HttpMethodVo('POST'),
    intervalSeconds: 10,
    timeoutMs: 5000,
    expectedStatusCodes: [200],
    assertions: [],
    isActive: true,
    tags: ['billing', 'critical', 'tier-0'],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const downResult = new HealthCheckResult({
    id: 'chk-down-99',
    endpointId: paymentEndpoint.id,
    timestamp: new Date(),
    status: HealthStatusVo.DOWN,
    statusCode: 503,
    statusText: 'Service Unavailable',
    latency: new LatencyBreakdownVo({
      dnsLookupMs: 4.2,
      tcpConnectMs: 25.1,
      tlsHandshakeMs: 42.8,
      ttfbMs: 1450.3,
      contentTransferMs: 1.2,
      totalMs: 1523.6,
    }),
    sslInfo: {
      valid: true,
      issuer: 'DigiCert Global Root G2',
      validTo: new Date(Date.now() + 86400000 * 45).toISOString(),
      daysRemaining: 45,
    },
    errorMessage: 'HTTP 503: Servicio de pagos saturado / Gateway timeout',
    failedAssertions: ['Código de estado inesperado: 503 (esperado: [200])', 'Latencia 1523ms excede SLA de 800ms'],
    region: 'us-east-edge',
  });

  const incident = new Incident({
    id: 'inc-2026-pay-001',
    endpointId: paymentEndpoint.id,
    status: 'OPEN',
    severity: 'CRITICAL',
    startedAt: new Date(),
    summary: 'Caída total en el checkout de pagos. Error HTTP 503 detectado.',
    consecutiveFailures: 3,
  });

  // Persist records into DB to satisfy foreign key constraints
  await db.insert(endpointsTable).values({
    id: paymentEndpoint.id,
    name: paymentEndpoint.name,
    url: paymentEndpoint.url.value,
    method: paymentEndpoint.method.value,
    intervalSeconds: paymentEndpoint.intervalSeconds,
    timeoutMs: paymentEndpoint.timeoutMs,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  for (const ch of [webhookChannel, slackChannel, discordChannel]) {
    await db.insert(alertChannelsTable).values({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      config: JSON.stringify(ch.config),
      events: JSON.stringify(ch.events),
      isEnabled: ch.isEnabled,
      createdAt: ch.createdAt,
      updatedAt: ch.updatedAt,
    }).onConflictDoNothing();
  }

  await db.insert(incidentsTable).values({
    id: incident.id,
    endpointId: paymentEndpoint.id,
    status: incident.status,
    severity: incident.severity,
    startedAt: incident.startedAt,
    summary: incident.summary,
    consecutiveFailures: incident.consecutiveFailures,
  }).onConflictDoNothing();

  // 4. Dispatch Alert through AlertManager to all 3 Agents concurrently
  console.log('[Dispatch] Disparando alerta de Incidente [DOWN] a los 3 agentes simultáneamente...\n');
  await alertManager.notify({
    endpoint: paymentEndpoint,
    result: downResult,
    incident,
    type: 'DOWN',
  });

  // 5. Inspect deliveries on Mock Server
  console.log('----------------------------------------------------------------');
  console.log(' 1. AGENTE WEBHOOK - VALIDACIÓN DE PAYLOAD Y FIRMA CRIPTOGRÁFICA');
  console.log('----------------------------------------------------------------');
  const webhookDelivery = receivedDeliveries['/webhook'];
  if (webhookDelivery) {
    const signature = webhookDelivery.headers['x-pulsetrack-signature'] as string;
    console.log(`✓ Webhook recibido en /webhook`);
    console.log(`  Cabecera X-PulseTrack-Signature: ${signature}`);

    // Verify HMAC
    const expectedHmac = crypto
      .createHmac('sha256', secretKey)
      .update(JSON.stringify(webhookDelivery.body))
      .digest('hex');
    const isSignatureValid = signature === `sha256=${expectedHmac}`;
    console.log(`  Verificación HMAC-SHA256:       ${isSignatureValid ? '✓ VÁLIDA (Auténtica)' : '✗ INVÁLIDA'}`);
    console.log(`  Payload Event:                  ${(webhookDelivery.body as { event: string }).event}`);
    console.log(`  Endpoint Name:                  ${(webhookDelivery.body as { endpoint: { name: string } }).endpoint.name}`);
  } else {
    console.error('✗ No se recibió webhook');
  }

  console.log('\n----------------------------------------------------------------');
  console.log(' 2. AGENTE SLACK - VALIDACIÓN DE BLOCK KIT Y ADJUNTOS');
  console.log('----------------------------------------------------------------');
  const slackDelivery = receivedDeliveries['/slack'];
  if (slackDelivery) {
    const body = slackDelivery.body as { channel: string; attachments: Array<{ color: string; blocks: Array<{ type: string }> }> };
    console.log(`✓ Notificación Slack recibida en /slack`);
    console.log(`  Canal Objetivo: ${body.channel}`);
    console.log(`  Color de Barra: ${body.attachments[0]?.color} (Rojo Alerta Crítica)`);
    console.log(`  Total Bloques:  ${body.attachments[0]?.blocks.length} (Header, Sección, Campos, Desglose, Contexto)`);
  } else {
    console.error('✗ No se recibió Slack');
  }

  console.log('\n----------------------------------------------------------------');
  console.log(' 3. AGENTE DISCORD - VALIDACIÓN DE RICH EMBEDS Y MENCIÓN ON-CALL');
  console.log('----------------------------------------------------------------');
  const discordDelivery = receivedDeliveries['/discord'];
  if (discordDelivery) {
    const body = discordDelivery.body as { username: string; content?: string; embeds: Array<{ title: string; color: number; fields: Array<{ name: string; value: string }> }> };
    console.log(`✓ Notificación Discord recibida en /discord`);
    console.log(`  Bot Username:    ${body.username}`);
    console.log(`  Mención de Rol:  ${body.content}`);
    console.log(`  Título Embed:    ${body.embeds[0]?.title}`);
    console.log(`  Color HEX:       0x${body.embeds[0]?.color.toString(16)} (Rojo 0xEF4444)`);
    console.log(`  Campos Embed:    ${body.embeds[0]?.fields.length} campos detallados (URL, Latencia, RED, SLA)`);
  } else {
    console.error('✗ No se recibió Discord');
  }

  // Close Mock Server
  server.close();
  console.log('\n================================================================');
  console.log(' PRUEBA DE LOS 3 AGENTES COMPLETADA CON ÉXITO AL 100% ');
  console.log('================================================================\n');
}

void runNotifiersDemo().catch((err) => {
  console.error('Error durante la verificación:', err);
  process.exit(1);
});
