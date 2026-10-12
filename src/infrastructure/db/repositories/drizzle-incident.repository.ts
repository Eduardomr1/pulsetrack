import { eq, and, desc } from 'drizzle-orm';
import { Database } from '../drizzle.client';
import { incidentsTable, IncidentRow } from '../schema/incidents.schema';
import { IIncidentRepository } from '../../../core/domain/ports/incident.repository';
import { Incident, IncidentStatus, IncidentSeverity } from '../../../core/domain/entities/incident.entity';

export class DrizzleIncidentRepository implements IIncidentRepository {
  constructor(private readonly db: Database) {}

  private toDomain(row: IncidentRow): Incident {
    return new Incident({
      id: row.id,
      endpointId: row.endpointId,
      status: row.status as IncidentStatus,
      severity: row.severity as IncidentSeverity,
      startedAt: row.startedAt,
      resolvedAt: row.resolvedAt,
      summary: row.summary,
      consecutiveFailures: row.consecutiveFailures,
    });
  }

  public async findActiveByEndpointId(endpointId: string): Promise<Incident | null> {
    const rows = await this.db
      .select()
      .from(incidentsTable)
      .where(
        and(
          eq(incidentsTable.endpointId, endpointId),
          eq(incidentsTable.status, 'OPEN')
        )
      )
      .limit(1);

    const first = rows[0];
    if (!first) return null;
    return this.toDomain(first);
  }

  public async findRecent(limit: number = 20): Promise<Incident[]> {
    const rows = await this.db
      .select()
      .from(incidentsTable)
      .orderBy(desc(incidentsTable.startedAt))
      .limit(limit);

    return rows.map((r: IncidentRow) => this.toDomain(r));
  }

  public async countActive(): Promise<number> {
    const rows = await this.db
      .select()
      .from(incidentsTable)
      .where(eq(incidentsTable.status, 'OPEN'));

    return rows.length;
  }

  public async save(incident: Incident): Promise<void> {
    await this.db.insert(incidentsTable).values({
      id: incident.id,
      endpointId: incident.endpointId,
      status: incident.status,
      severity: incident.severity,
      startedAt: incident.startedAt,
      resolvedAt: incident.resolvedAt,
      summary: incident.summary,
      consecutiveFailures: incident.consecutiveFailures,
    });
  }

  public async update(incident: Incident): Promise<void> {
    await this.db
      .update(incidentsTable)
      .set({
        status: incident.status,
        severity: incident.severity,
        resolvedAt: incident.resolvedAt,
        summary: incident.summary,
        consecutiveFailures: incident.consecutiveFailures,
      })
      .where(eq(incidentsTable.id, incident.id));
  }
}
