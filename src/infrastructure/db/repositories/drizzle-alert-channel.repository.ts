import { eq, and, gte } from 'drizzle-orm';
import { Database } from '../drizzle.client';
import {
  alertChannelsTable,
  AlertChannelRow,
  notificationLogsTable,
} from '../schema/alert-channels.schema';
import { IAlertChannelRepository } from '../../../core/domain/ports/alert-channel.repository';
import {
  AlertChannel,
  AlertChannelType,
  AlertEventType,
  ChannelConfig,
} from '../../../core/domain/entities/alert-channel.entity';

export class DrizzleAlertChannelRepository implements IAlertChannelRepository {
  constructor(private readonly db: Database) {}

  private toDomain(row: AlertChannelRow): AlertChannel {
    let parsedConfig: ChannelConfig = { webhookUrl: '' };
    try {
      parsedConfig = JSON.parse(row.config) as ChannelConfig;
    } catch (err: unknown) {
      console.error(`[AlertChannelRepository] Error parseando config JSON para canal ${row.id}:`, err);
    }

    let parsedEvents: AlertEventType[] = ['DOWN', 'RECOVERED'];
    try {
      parsedEvents = JSON.parse(row.events) as AlertEventType[];
    } catch (err: unknown) {
      console.error(`[AlertChannelRepository] Error parseando events JSON para canal ${row.id}:`, err);
    }

    return new AlertChannel({
      id: row.id,
      name: row.name,
      type: row.type as AlertChannelType,
      config: parsedConfig,
      events: parsedEvents,
      isEnabled: Boolean(row.isEnabled),
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt),
    });
  }

  public async findById(id: string): Promise<AlertChannel | null> {
    const rows = await this.db
      .select()
      .from(alertChannelsTable)
      .where(eq(alertChannelsTable.id, id))
      .limit(1);

    const first = rows[0];
    if (!first) return null;
    return this.toDomain(first);
  }

  public async findAll(): Promise<AlertChannel[]> {
    const rows = await this.db.select().from(alertChannelsTable);
    return rows.map((r) => this.toDomain(r));
  }

  public async save(channel: AlertChannel): Promise<void> {
    await this.db.insert(alertChannelsTable).values({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      config: JSON.stringify(channel.config),
      events: JSON.stringify(channel.events),
      isEnabled: channel.isEnabled,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
    });
  }

  public async update(channel: AlertChannel): Promise<void> {
    await this.db
      .update(alertChannelsTable)
      .set({
        name: channel.name,
        type: channel.type,
        config: JSON.stringify(channel.config),
        events: JSON.stringify(channel.events),
        isEnabled: channel.isEnabled,
        updatedAt: channel.updatedAt,
      })
      .where(eq(alertChannelsTable.id, channel.id));
  }

  public async delete(id: string): Promise<void> {
    await this.db.delete(notificationLogsTable).where(eq(notificationLogsTable.channelId, id));
    await this.db.delete(alertChannelsTable).where(eq(alertChannelsTable.id, id));
  }

  public async countAlertsSentSince(channelId: string, since: Date): Promise<number> {
    const rows = await this.db
      .select()
      .from(notificationLogsTable)
      .where(
        and(
          eq(notificationLogsTable.channelId, channelId),
          gte(notificationLogsTable.timestamp, since),
          eq(notificationLogsTable.status, 'SENT')
        )
      );

    return rows.length;
  }
}
