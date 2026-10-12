import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const endpointsTable = sqliteTable(
  'endpoints',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    method: text('method').notNull().default('GET'),
    headers: text('headers').default('{}'), // JSON: Record<string, string>
    body: text('body'),
    intervalSeconds: integer('interval_seconds').notNull().default(30),
    timeoutMs: integer('timeout_ms').notNull().default(5000),
    expectedStatusCodes: text('expected_status_codes').notNull().default('[200]'), // JSON: number[]
    assertions: text('assertions').notNull().default('[]'), // JSON: AssertionRule[]
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    tags: text('tags').notNull().default('[]'), // JSON: string[]
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('idx_endpoints_active').on(table.isActive),
  ]
);

export type EndpointRow = typeof endpointsTable.$inferSelect;
export type InsertEndpointRow = typeof endpointsTable.$inferInsert;
