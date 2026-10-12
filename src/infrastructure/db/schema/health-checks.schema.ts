import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { endpointsTable } from './endpoints.schema';

export const healthChecksTable = sqliteTable(
  'health_checks',
  {
    id: text('id').primaryKey(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => endpointsTable.id, { onDelete: 'cascade' }),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
    status: text('status').notNull(), // 'HEALTHY' | 'DEGRADED' | 'DOWN'
    statusCode: integer('status_code'),
    statusText: text('status_text'),
    dnsLookupMs: real('dns_lookup_ms').notNull().default(0),
    tcpConnectMs: real('tcp_connect_ms').notNull().default(0),
    tlsHandshakeMs: real('tls_handshake_ms').notNull().default(0),
    ttfbMs: real('ttfb_ms').notNull().default(0),
    contentTransferMs: real('content_transfer_ms').notNull().default(0),
    totalMs: real('total_ms').notNull().default(0),
    sslInfo: text('ssl_info'), // JSON: SslInfo
    errorMessage: text('error_message'),
    failedAssertions: text('failed_assertions').notNull().default('[]'), // JSON: string[]
    responseHeaders: text('response_headers'), // JSON: Record<string, string>
    region: text('region').notNull().default('primary'),
  },
  (table) => [
    index('idx_health_checks_endpoint_time').on(table.endpointId, table.timestamp),
    index('idx_health_checks_status').on(table.status),
  ]
);

export type HealthCheckRow = typeof healthChecksTable.$inferSelect;
export type InsertHealthCheckRow = typeof healthChecksTable.$inferInsert;
