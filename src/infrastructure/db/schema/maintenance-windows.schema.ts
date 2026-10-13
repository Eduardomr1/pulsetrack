import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const maintenanceWindowsTable = sqliteTable('maintenance_windows', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  startTime: integer('start_time', { mode: 'timestamp_ms' }).notNull(),
  endTime: integer('end_time', { mode: 'timestamp_ms' }).notNull(),
  affectedEndpoints: text('affected_endpoints').notNull().default('[]'), // JSON string[]: endpoint IDs or ['*'] for all
  status: text('status').notNull().default('SCHEDULED'), // 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED'
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export type MaintenanceWindowRow = typeof maintenanceWindowsTable.$inferSelect;
export type InsertMaintenanceWindowRow = typeof maintenanceWindowsTable.$inferInsert;
