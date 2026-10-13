import { eq, and, desc, or } from 'drizzle-orm';
import { Database } from '../drizzle.client';
import { incidentsTable, IncidentRow } from '../schema/incidents.schema';
import { IIncidentRepository } from '../../../core/domain/ports/incident.repository';
import {
  Incident,
  IncidentStatus,
  IncidentSeverity,
  IncidentTimelineEvent,
} from '../../../core/domain/entities/incident.entity';

export class DrizzleIncidentRepository implements IIncidentRepository {
  constructor(private readonly db: Database) {}

  private toDomain(row: IncidentRow): Incident {
    let timeline: IncidentTimelineEvent[] = [];
    try {
      timeline = JSON.parse(row.timeline || '[]') as IncidentTimelineEvent[];
    } catch {
      timeline = [];
    }

    return new Incident({
      id: row.id,
      endpointId: row.endpointId,
      status: row.status as IncidentStatus,
      severity: row.severity as IncidentSeverity,
      startedAt: row.startedAt,
      acknowledgedAt: row.acknowledgedAt,
      resolvedAt: row.resolvedAt,
      summary: row.summary,
      rootCause: row.rootCause,
      consecutiveFailures: row.consecutiveFailures,
      timeline,
    });
  }

  public async findById(id: string): Promise<Incident | null> {
    const rows = await this.db
      .select()
      .from(incidentsTable)
      .where(eq(incidentsTable.id, id))
      .limit(1);

    const first = rows[0];
    if (!first) return null;
    return this.toDomain(first);
  }

  public async findAll(limit: number = 50): Promise<Incident[]> {
    const rows = await this.db
      .select()
      .from(incidentsTable)
      .orderBy(desc(incidentsTable.startedAt))
      .limit(limit);

    return rows.map((r: IncidentRow) => this.toDomain(r));
  }

  public async findActiveByEndpointId(endpointId: string): Promise<Incident | null> {
    const rows = await this.db
      .select()
      .from(incidentsTable)
      .where(
        and(
          eq(incidentsTable.endpointId, endpointId),
          or(eq(incidentsTable.status, 'OPEN'), eq(incidentsTable.status, 'INVESTIGATING'))
        )
      )
      .limit(1);

    const first = rows[0];
    if (!first) return null;
    return this.toDomain(first);
  }

  public async findByEndpointId(endpointId: string, limit: number = 20): Promise<Incident[]> {
    const rows = await this.db
      .select()
      .from(incidentsTable)
      .where(eq(incidentsTable.endpointId, endpointId))
      .orderBy(desc(incidentsTable.startedAt))
      .limit(limit);

    return rows.map((r: IncidentRow) => this.toDomain(r));
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
      .where(or(eq(incidentsTable.status, 'OPEN'), eq(incidentsTable.status, 'INVESTIGATING')));

    return rows.length;
  }

  public async save(incident: Incident): Promise<void> {
    await this.db.insert(incidentsTable).values({
      id: incident.id,
      endpointId: incident.endpointId,
      status: incident.status,
      severity: incident.severity,
      startedAt: incident.startedAt,
      acknowledgedAt: incident.acknowledgedAt,
      resolvedAt: incident.resolvedAt,
      summary: incident.summary,
      rootCause: incident.rootCause,
      consecutiveFailures: incident.consecutiveFailures,
      timeline: JSON.stringify(incident.timeline),
    });
  }

  public async update(incident: Incident): Promise<void> {
    await this.db
      .update(incidentsTable)
      .set({
        status: incident.status,
        severity: incident.severity,
        acknowledgedAt: incident.acknowledgedAt,
        resolvedAt: incident.resolvedAt,
        summary: incident.summary,
        rootCause: incident.rootCause,
        consecutiveFailures: incident.consecutiveFailures,
        timeline: JSON.stringify(incident.timeline),
      })
      .where(eq(incidentsTable.id, incident.id));
  }
}
