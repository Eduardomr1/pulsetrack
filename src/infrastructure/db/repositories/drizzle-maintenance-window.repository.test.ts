import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../schema';
import { Database } from '../drizzle.client';
import { MaintenanceWindow } from '../../../core/domain/entities/maintenance-window.entity';
import { DrizzleMaintenanceWindowRepository } from './drizzle-maintenance-window.repository';

describe('DrizzleMaintenanceWindowRepository (SQLite in-memory)', () => {
  let repo: DrizzleMaintenanceWindowRepository;

  beforeEach(async () => {
    const client = createClient({ url: ':memory:' });
    await client.execute(`
      CREATE TABLE maintenance_windows (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        affected_endpoints TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'SCHEDULED',
        created_at INTEGER NOT NULL
      );
    `);
    const testDb = drizzle(client, { schema }) as unknown as Database;
    repo = new DrizzleMaintenanceWindowRepository(testDb);
  });

  it('persiste, recupera por id y actualiza una ventana de mantenimiento', async () => {
    const win = new MaintenanceWindow({
      id: 'maint-1',
      title: 'Actualización TLS Edge',
      description: 'Rotación controlada de certificados',
      startTime: new Date('2026-11-13T04:00:00Z'),
      endTime: new Date('2026-11-13T04:30:00Z'),
      affectedEndpoints: ['ep-auth', 'ep-gateway'],
    });

    await repo.save(win);

    const fetched = await repo.findById('maint-1');
    expect(fetched).not.toBeNull();
    expect(fetched?.title).toBe('Actualización TLS Edge');
    expect(fetched?.affectedEndpoints).toEqual(['ep-auth', 'ep-gateway']);
    expect(fetched?.status).toBe('SCHEDULED');

    win.cancel();
    await repo.update(win);

    const updated = await repo.findById('maint-1');
    expect(updated?.status).toBe('CANCELLED');
  });

  it('consulta ventanas activas en un instante y excluye canceladas', async () => {
    const activeWildcard = new MaintenanceWindow({
      id: 'maint-global',
      title: 'Parche Kernel Red',
      startTime: new Date('2026-11-13T02:00:00Z'),
      endTime: new Date('2026-11-13T03:00:00Z'),
      affectedEndpoints: ['*'],
    });

    const cancelledWin = new MaintenanceWindow({
      id: 'maint-cancelled',
      title: 'Deploy abortado',
      startTime: new Date('2026-11-13T02:00:00Z'),
      endTime: new Date('2026-11-13T03:00:00Z'),
      affectedEndpoints: ['ep-payments'],
      status: 'CANCELLED',
    });

    const otherEndpointWin = new MaintenanceWindow({
      id: 'maint-other',
      title: 'Solo Analytics',
      startTime: new Date('2026-11-13T02:00:00Z'),
      endTime: new Date('2026-11-13T03:00:00Z'),
      affectedEndpoints: ['ep-analytics'],
    });

    await repo.save(activeWildcard);
    await repo.save(cancelledWin);
    await repo.save(otherEndpointWin);

    const matchesPayments = await repo.findActiveAt(
      new Date('2026-11-13T02:30:00Z'),
      'ep-payments'
    );
    expect(matchesPayments.map((w) => w.id)).toEqual(['maint-global']);

    const matchesAnalytics = await repo.findActiveAt(
      new Date('2026-11-13T02:30:00Z'),
      'ep-analytics'
    );
    expect(matchesAnalytics.map((w) => w.id)).toHaveLength(2);
  });

  it('filtra ventanas solapadas dentro de un rango temporal por endpoint', async () => {
    await repo.save(
      new MaintenanceWindow({
        id: 'mw-in-range',
        title: 'Migración PG',
        startTime: new Date('2026-11-13T05:00:00Z'),
        endTime: new Date('2026-11-13T06:00:00Z'),
        affectedEndpoints: ['ep-orders'],
      })
    );

    await repo.save(
      new MaintenanceWindow({
        id: 'mw-outside',
        title: 'Mantenimiento previo',
        startTime: new Date('2026-11-13T01:00:00Z'),
        endTime: new Date('2026-11-13T02:00:00Z'),
        affectedEndpoints: ['ep-orders'],
      })
    );

    const overlapping = await repo.findOverlappingRange({
      from: new Date('2026-11-13T04:30:00Z'),
      to: new Date('2026-11-13T05:30:00Z'),
      endpointId: 'ep-orders',
    });

    expect(overlapping.map((w) => w.id)).toEqual(['mw-in-range']);
  });
});
