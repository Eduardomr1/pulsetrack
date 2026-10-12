import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { endpointsTable } from './endpoints.schema';
import { incidentsTable } from './incidents.schema';

export const alertChannelsTable = sqliteTable(
  'alert_channels',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull(), // 'WEBHOOK' | 'SLACK' | 'DISCORD'
    config: text('config').notNull(), // JSON: ChannelConfig
    events: text('events').notNull().default('["DOWN","RECOVERED"]'), // JSON: AlertEventType[]
    isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('idx_alert_channels_enabled').on(table.isEnabled),
  ]
);

export const notificationLogsTable = sqliteTable(
  'notification_logs',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => alertChannelsTable.id, { onDelete: 'cascade' }),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => endpointsTable.id, { onDelete: 'cascade' }),
    incidentId: text('incident_id').references(() => incidentsTable.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(), // 'DOWN' | 'DEGRADED' | 'RECOVERED'
    status: text('status').notNull(), // 'SENT' | 'FAILED'
    responseCode: integer('response_code'),
    errorMessage: text('error_message'),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('idx_notification_logs_endpoint').on(table.endpointId, table.timestamp),
    index('idx_notification_logs_channel').on(table.channelId),
  ]
);

export type AlertChannelRow = typeof alertChannelsTable.$inferSelect;
export type InsertAlertChannelRow = typeof alertChannelsTable.$inferInsert;
export type NotificationLogRow = typeof notificationLogsTable.$inferSelect;
export type InsertNotificationLogRow = typeof notificationLogsTable.$inferInsert;
