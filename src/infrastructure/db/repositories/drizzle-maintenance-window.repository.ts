import { and, desc, eq, gt, gte, lt, lte, ne } from 'drizzle-orm';
import { Database } from '../drizzle.client';
import {
  MaintenanceWindowRow,
  maintenanceWindowsTable,
} from '../schema/maintenance-windows.schema';
import {
  IMaintenanceWindowRepository,
  MaintenanceWindowRangeQuery,
} from '../../../core/domain/ports/maintenance-window.repository';
import {
  MaintenanceWindow,
  MaintenanceWindowStatus,
} from '../../../core/domain/entities/maintenance-window.entity';

const VALID_STATUSES = new Set<MaintenanceWindowStatus>([
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);

/**
 * Adaptador de persistencia Drizzle/SQLite para el repositorio de ventanas de mantenimiento.
 */
export class DrizzleMaintenanceWindowRepository implements IMaintenanceWindowRepository {
  constructor(private readonly db: Database) {}

  private toDomain(row: MaintenanceWindowRow): MaintenanceWindow {
    let affected: string[] = ['*'];
    try {
      const parsed = JSON.parse(row.affectedEndpoints || '["*"]') as string[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        affected = parsed;
      }
    } catch {
      affected = ['*'];
    }

    const status: MaintenanceWindowStatus = VALID_STATUSES.has(
      row.status as MaintenanceWindowStatus
    )
      ? (row.status as MaintenanceWindowStatus)
      : 'SCHEDULED';

    return new MaintenanceWindow({
      id: row.id,
      title: row.title,
      description: row.description,
      startTime: row.startTime,
      endTime: row.endTime,
      affectedEndpoints: affected,
      status,
      createdAt: row.createdAt,
    });
  }

  public async findById(id: string): Promise<MaintenanceWindow | null> {
    const rows = await this.db
      .select()
      .from(maintenanceWindowsTable)
      .where(eq(maintenanceWindowsTable.id, id))
      .limit(1);

    const first = rows[0];
    return first ? this.toDomain(first) : null;
  }

  public async findAll(): Promise<MaintenanceWindow[]> {
    const rows = await this.db
      .select()
      .from(maintenanceWindowsTable)
      .orderBy(desc(maintenanceWindowsTable.startTime));

    return rows.map((row) => this.toDomain(row));
  }

  public async findOverlappingRange(
    query: MaintenanceWindowRangeQuery
  ): Promise<MaintenanceWindow[]> {
    const rows = await this.db
      .select()
      .from(maintenanceWindowsTable)
      .where(
        and(
          ne(maintenanceWindowsTable.status, 'CANCELLED'),
          lt(maintenanceWindowsTable.startTime, query.to),
          gt(maintenanceWindowsTable.endTime, query.from)
        )
      )
      .orderBy(desc(maintenanceWindowsTable.startTime));

    const windows = rows.map((row) => this.toDomain(row));
    if (!query.endpointId) {
      return windows;
    }

    return windows.filter((win) => win.appliesToEndpoint(query.endpointId!));
  }

  public async findActiveAt(
    timestamp: Date,
    endpointId?: string
  ): Promise<MaintenanceWindow[]> {
    const rows = await this.db
      .select()
      .from(maintenanceWindowsTable)
      .where(
        and(
          ne(maintenanceWindowsTable.status, 'CANCELLED'),
          lte(maintenanceWindowsTable.startTime, timestamp),
          gte(maintenanceWindowsTable.endTime, timestamp)
        )
      );

    return rows
      .map((row) => this.toDomain(row))
      .filter((win) => win.containsTimestamp(timestamp, endpointId));
  }

  public async save(window: MaintenanceWindow): Promise<void> {
    await this.db.insert(maintenanceWindowsTable).values({
      id: window.id,
      title: window.title,
      description: window.description,
      startTime: window.startTime,
      endTime: window.endTime,
      affectedEndpoints: JSON.stringify(window.affectedEndpoints),
      status: window.status,
      createdAt: window.createdAt,
    });
  }

  public async update(window: MaintenanceWindow): Promise<void> {
    await this.db
      .update(maintenanceWindowsTable)
      .set({
        title: window.title,
        description: window.description,
        affectedEndpoints: JSON.stringify(window.affectedEndpoints),
        status: window.status,
      })
      .where(eq(maintenanceWindowsTable.id, window.id));
  }
}
