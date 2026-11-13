import { describe, expect, it } from 'vitest';
import { MaintenanceWindow } from '../../domain/entities/maintenance-window.entity';
import {
  IMaintenanceWindowRepository,
  MaintenanceWindowRangeQuery,
} from '../../domain/ports/maintenance-window.repository';
import { ScheduleMaintenanceWindowUseCase } from './schedule-maintenance-window.use-case';

class InMemoryMaintenanceRepo implements IMaintenanceWindowRepository {
  public readonly store: MaintenanceWindow[] = [];

  public async findById(id: string): Promise<MaintenanceWindow | null> {
    return this.store.find((w) => w.id === id) ?? null;
  }

  public async findAll(): Promise<MaintenanceWindow[]> {
    return [...this.store];
  }

  public async findOverlappingRange(
    query: MaintenanceWindowRangeQuery
  ): Promise<MaintenanceWindow[]> {
    return this.store.filter(
      (w) => w.isEffective() && w.computeOverlapMs(query.from, query.to, query.endpointId) > 0
    );
  }

  public async findActiveAt(timestamp: Date, endpointId?: string): Promise<MaintenanceWindow[]> {
    return this.store.filter((w) => w.containsTimestamp(timestamp, endpointId));
  }

  public async save(window: MaintenanceWindow): Promise<void> {
    this.store.push(window);
  }

  public async update(window: MaintenanceWindow): Promise<void> {
    const idx = this.store.findIndex((w) => w.id === window.id);
    if (idx >= 0) this.store[idx] = window;
  }
}

describe('ScheduleMaintenanceWindowUseCase', () => {
  it('persiste ventana sin conflictos y retorna reporte de asesoría LOW', async () => {
    const repo = new InMemoryMaintenanceRepo();
    const useCase = new ScheduleMaintenanceWindowUseCase(repo);

    const result = await useCase.execute({
      title: 'Rotación de certificados TLS',
      startTime: new Date('2026-11-13T04:00:00Z'),
      endTime: new Date('2026-11-13T04:10:00Z'),
      affectedEndpoints: ['ep-auth'],
    });

    expect(repo.store).toHaveLength(1);
    expect(result.window.title).toBe('Rotación de certificados TLS');
    expect(result.advisory.riskLevel).toBe('LOW');
    expect(result.advisory.hasBlockingOverlap).toBe(false);
  });

  it('rechaza el guardado cuando rejectOnOverlapConflict=true y existe colisión', async () => {
    const repo = new InMemoryMaintenanceRepo();
    repo.store.push(
      new MaintenanceWindow({
        id: 'mw-1',
        title: 'Mantenimiento Core',
        startTime: new Date('2026-11-13T02:00:00Z'),
        endTime: new Date('2026-11-13T03:00:00Z'),
        affectedEndpoints: ['ep-payments'],
      })
    );

    const useCase = new ScheduleMaintenanceWindowUseCase(repo);

    await expect(
      useCase.execute({
        title: 'Upgrade paralelo',
        startTime: new Date('2026-11-13T02:30:00Z'),
        endTime: new Date('2026-11-13T03:15:00Z'),
        affectedEndpoints: ['ep-payments'],
        rejectOnOverlapConflict: true,
      })
    ).rejects.toThrow(/Conflicto bloqueante/);

    expect(repo.store).toHaveLength(1);
  });

  it('permite programar con advertencia de solapamiento cuando rejectOnOverlapConflict=false', async () => {
    const repo = new InMemoryMaintenanceRepo();
    repo.store.push(
      new MaintenanceWindow({
        id: 'mw-1',
        title: 'Cambio Base de Datos',
        startTime: new Date('2026-11-13T02:00:00Z'),
        endTime: new Date('2026-11-13T02:30:00Z'),
        affectedEndpoints: ['ep-orders'],
      })
    );

    const useCase = new ScheduleMaintenanceWindowUseCase(repo);

    const result = await useCase.execute({
      title: 'Purga de caché',
      startTime: new Date('2026-11-13T02:15:00Z'),
      endTime: new Date('2026-11-13T02:45:00Z'),
      affectedEndpoints: ['ep-orders'],
      rejectOnOverlapConflict: false,
    });

    expect(repo.store).toHaveLength(2);
    expect(result.advisory.hasBlockingOverlap).toBe(true);
    expect(result.advisory.conflicts[0]?.overlapMinutes).toBe(15);
  });
});
