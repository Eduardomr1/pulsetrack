import { libsqlClient } from './drizzle.client';

export async function initDatabase(): Promise<void> {
  await libsqlClient.execute(`
    CREATE TABLE IF NOT EXISTS endpoints (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      headers TEXT DEFAULT '{}',
      body TEXT,
      interval_seconds INTEGER NOT NULL DEFAULT 30,
      timeout_ms INTEGER NOT NULL DEFAULT 5000,
      expected_status_codes TEXT NOT NULL DEFAULT '[200]',
      assertions TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await libsqlClient.execute(`
    CREATE TABLE IF NOT EXISTS health_checks (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      status_code INTEGER,
      status_text TEXT,
      dns_lookup_ms REAL NOT NULL DEFAULT 0,
      tcp_connect_ms REAL NOT NULL DEFAULT 0,
      tls_handshake_ms REAL NOT NULL DEFAULT 0,
      ttfb_ms REAL NOT NULL DEFAULT 0,
      content_transfer_ms REAL NOT NULL DEFAULT 0,
      total_ms REAL NOT NULL DEFAULT 0,
      ssl_info TEXT,
      error_message TEXT,
      failed_assertions TEXT NOT NULL DEFAULT '[]',
      response_headers TEXT,
      region TEXT NOT NULL DEFAULT 'primary'
    );
  `);

  await libsqlClient.execute(`
    CREATE INDEX IF NOT EXISTS idx_health_checks_endpoint_time 
    ON health_checks (endpoint_id, timestamp);
  `);

  await libsqlClient.execute(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      severity TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      acknowledged_at INTEGER,
      resolved_at INTEGER,
      summary TEXT NOT NULL,
      root_cause TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 1,
      timeline TEXT NOT NULL DEFAULT '[]'
    );
  `);

  // Safe migrations if incidents table already existed
  try { await libsqlClient.execute(`ALTER TABLE incidents ADD COLUMN acknowledged_at INTEGER;`); } catch {}
  try { await libsqlClient.execute(`ALTER TABLE incidents ADD COLUMN root_cause TEXT;`); } catch {}
  try { await libsqlClient.execute(`ALTER TABLE incidents ADD COLUMN timeline TEXT NOT NULL DEFAULT '[]';`); } catch {}

  await libsqlClient.execute(`
    CREATE INDEX IF NOT EXISTS idx_incidents_endpoint_status 
    ON incidents (endpoint_id, status);
  `);

  await libsqlClient.execute(`
    CREATE TABLE IF NOT EXISTS maintenance_windows (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      affected_endpoints TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      created_at INTEGER NOT NULL
    );
  `);

  await libsqlClient.execute(`
    CREATE TABLE IF NOT EXISTS alert_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '["DOWN","RECOVERED"]',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await libsqlClient.execute(`
    CREATE TABLE IF NOT EXISTS notification_logs (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES alert_channels(id) ON DELETE CASCADE,
      endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
      incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      response_code INTEGER,
      error_message TEXT,
      timestamp INTEGER NOT NULL
    );
  `);

  await libsqlClient.execute(`
    CREATE INDEX IF NOT EXISTS idx_notification_logs_endpoint 
    ON notification_logs (endpoint_id, timestamp);
  `);

  console.log('[PulseTrack DB] Tablas e índices inicializados correctamente.');
}
