import { eq } from 'drizzle-orm';
import { Database } from '../drizzle.client';
import { endpointsTable, EndpointRow } from '../schema/endpoints.schema';
import { healthChecksTable } from '../schema/health-checks.schema';
import { incidentsTable } from '../schema/incidents.schema';
import { IEndpointRepository } from '../../../core/domain/ports/endpoint.repository';
import { Endpoint } from '../../../core/domain/entities/endpoint.entity';
import { UrlVo } from '../../../core/domain/value-objects/url.vo';
import { HttpMethodVo } from '../../../core/domain/value-objects/http-method.vo';
import { AssertionVo, AssertionRule } from '../../../core/domain/value-objects/assertion.vo';

export class DrizzleEndpointRepository implements IEndpointRepository {
  constructor(private readonly db: Database) {}

  private toDomain(row: EndpointRow): Endpoint {
    const rawAssertions = JSON.parse(row.assertions || '[]') as AssertionRule[];
    const rawHeaders = JSON.parse(row.headers || '{}') as Record<string, string>;
    const rawExpectedCodes = JSON.parse(row.expectedStatusCodes || '[200]') as number[];
    const rawTags = JSON.parse(row.tags || '[]') as string[];

    return new Endpoint({
      id: row.id,
      name: row.name,
      url: new UrlVo(row.url),
      method: new HttpMethodVo(row.method),
      headers: rawHeaders,
      body: row.body,
      intervalSeconds: row.intervalSeconds,
      timeoutMs: row.timeoutMs,
      expectedStatusCodes: rawExpectedCodes,
      assertions: rawAssertions.map((a) => new AssertionVo(a)),
      isActive: row.isActive,
      tags: rawTags,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  public async findById(id: string): Promise<Endpoint | null> {
    const rows = await this.db
      .select()
      .from(endpointsTable)
      .where(eq(endpointsTable.id, id))
      .limit(1);

    const first = rows[0];
    if (!first) return null;
    return this.toDomain(first);
  }

  public async findAll(): Promise<Endpoint[]> {
    const rows = await this.db.select().from(endpointsTable);
    return rows.map((r) => this.toDomain(r));
  }

  public async findAllActive(): Promise<Endpoint[]> {
    const rows = await this.db
      .select()
      .from(endpointsTable)
      .where(eq(endpointsTable.isActive, true));
    return rows.map((r) => this.toDomain(r));
  }

  public async save(endpoint: Endpoint): Promise<void> {
    await this.db.insert(endpointsTable).values({
      id: endpoint.id,
      name: endpoint.name,
      url: endpoint.url.value,
      method: endpoint.method.value,
      headers: JSON.stringify(endpoint.headers),
      body: endpoint.body,
      intervalSeconds: endpoint.intervalSeconds,
      timeoutMs: endpoint.timeoutMs,
      expectedStatusCodes: JSON.stringify(endpoint.expectedStatusCodes),
      assertions: JSON.stringify(endpoint.assertions.map((a) => a.toJSON())),
      isActive: endpoint.isActive,
      tags: JSON.stringify(endpoint.tags),
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt,
    });
  }

  public async update(endpoint: Endpoint): Promise<void> {
    await this.db
      .update(endpointsTable)
      .set({
        name: endpoint.name,
        url: endpoint.url.value,
        method: endpoint.method.value,
        headers: JSON.stringify(endpoint.headers),
        body: endpoint.body,
        intervalSeconds: endpoint.intervalSeconds,
        timeoutMs: endpoint.timeoutMs,
        expectedStatusCodes: JSON.stringify(endpoint.expectedStatusCodes),
        assertions: JSON.stringify(endpoint.assertions.map((a: AssertionVo) => a.toJSON())),
        isActive: endpoint.isActive,
        tags: JSON.stringify(endpoint.tags),
        updatedAt: endpoint.updatedAt,
      })
      .where(eq(endpointsTable.id, endpoint.id));
  }

  public async delete(id: string): Promise<void> {
    await this.db.delete(healthChecksTable).where(eq(healthChecksTable.endpointId, id));
    await this.db.delete(incidentsTable).where(eq(incidentsTable.endpointId, id));
    await this.db.delete(endpointsTable).where(eq(endpointsTable.id, id));
  }
}
