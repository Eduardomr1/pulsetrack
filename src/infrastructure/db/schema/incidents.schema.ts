import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { endpointsTable } from './endpoints.schema';

export const incidentsTable = sqliteTable(
  'incidents',
  {
    id: text('id').primaryKey(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => endpointsTable.id, { onDelete: 'cascade' }),
    status: text('status').notNull(), // 'OPEN' | 'INVESTIGATING' | 'RESOLVED'
    severity: text('severity').notNull(), // 'CRITICAL' | 'WARNING' | 'INFO'
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    acknowledgedAt: integer('acknowledged_at', { mode: 'timestamp_ms' }),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
    summary: text('summary').notNull(),
    rootCause: text('root_cause'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(1),
    timeline: text('timeline').notNull().default('[]'), // JSON string: IncidentTimelineEvent[]
  },
  (table) => [
    index('idx_incidents_endpoint_status').on(table.endpointId, table.status),
    index('idx_incidents_status').on(table.status),
  ]
);

export type IncidentRow = typeof incidentsTable.$inferSelect;
export type InsertIncidentRow = typeof incidentsTable.$inferInsert;
