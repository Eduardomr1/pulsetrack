import { initDatabase } from '../db/migrate-local';
import { pollingScheduler, endpointRepository } from '../container';

async function startPollerDaemon() {
  console.log('===========================================================');
  console.log('  PULSETRACK OBSERVABILITY - BACKGROUND POLLING DAEMON     ');
  console.log('===========================================================\n');

  await initDatabase();

  const endpoints = await endpointRepository.findAllActive();
  console.log(`[Daemon] Monitores activos cargados: ${endpoints.length}`);
  endpoints.forEach((ep) => {
    console.log(`  • ${ep.name} [${ep.method.value} ${ep.url.value}] cada ${ep.intervalSeconds}s`);
  });

  console.log('\n[Daemon] Iniciando motor de sondeo adaptativo con jitter...');
  pollingScheduler.start();

  // Handle graceful termination
  const shutdown = () => {
    console.log('\n[Daemon] Recibida señal de detención. Cerrando scheduler...');
    pollingScheduler.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void startPollerDaemon().catch((err) => {
  console.error('[Daemon] Error crítico:', err);
  process.exit(1);
});
