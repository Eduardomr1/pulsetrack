import { describe, expect, it } from 'vitest';
import { MaintenanceWindow } from '../entities/maintenance-window.entity';
import { DependencyEdge, ServiceNode } from '../entities/service-dependency.entity';
import { MaintenanceScheduleAdvisorService } from './maintenance-schedule-advisor.service';

describe('MaintenanceScheduleAdvisorService', () => {
  const baseStart = new Date('2026-11-13T02:00:00Z');
  const baseEnd = new Date('2026-11-13T02:30:00Z');

  it('aprueba con riesgo LOW una ventana aislada de 10 minutos sin conflictos', () => {
    const candidate = new MaintenanceWindow({
      id: 'mw-1',
      title: 'Parche de seguridad menor',
      startTime: new Date('2026-11-13T03:00:00Z'),
      endTime: new Date('2026-11-13T03:10:00Z'),
      affectedEndpoints: ['ep-payments'],
    });

    const advisory = MaintenanceScheduleAdvisorService.evaluateSchedule(candidate, []);

    expect(advisory.riskLevel).toBe('LOW');
    expect(advisory.hasBlockingOverlap).toBe(false);
    expect(advisory.conflicts).toHaveLength(0);
    expect(advisory.durationMinutes).toBe(10);
    expect(advisory.errorBudgetProtection.totalAllowedBudgetMinutes).toBe(43.2);
    expect(advisory.errorBudgetProtection.exceedsMonthlyErrorBudget).toBe(false);
  });

  it('detecta DIRECT_OVERLAP entre ventanas que comparten endpoint y horario', () => {
    const existing = new MaintenanceWindow({
      id: 'mw-existing',
      title: 'Migración DB',
      startTime: baseStart,
      endTime: baseEnd,
      affectedEndpoints: ['ep-api', 'ep-auth'],
    });

    const candidate = new MaintenanceWindow({
      id: 'mw-cand',
      title: 'Reinicio caché Redis',
      startTime: new Date('2026-11-13T02:15:00Z'),
      endTime: new Date('2026-11-13T02:45:00Z'),
      affectedEndpoints: ['ep-auth', 'ep-orders'],
    });

    const advisory = MaintenanceScheduleAdvisorService.evaluateSchedule(candidate, [existing]);

    expect(advisory.hasBlockingOverlap).toBe(true);
    expect(advisory.riskLevel).toBe('HIGH');
    expect(advisory.conflicts).toHaveLength(1);
    expect(advisory.conflicts[0]?.conflictType).toBe('DIRECT_OVERLAP');
    expect(advisory.conflicts[0]?.overlapMinutes).toBe(15);
    expect(advisory.conflicts[0]?.overlappingTargets).toEqual(['ep-auth']);
  });

  it('detecta WILDCARD_OVERLAP cuando una ventana global "*" coincide con un endpoint específico', () => {
    const globalWindow = new MaintenanceWindow({
      id: 'mw-global',
      title: 'Mantenimiento red core',
      startTime: baseStart,
      endTime: baseEnd,
      affectedEndpoints: ['*'],
    });

    const candidate = new MaintenanceWindow({
      id: 'mw-billing',
      title: 'Deploy Billing',
      startTime: new Date('2026-11-13T02:10:00Z'),
      endTime: new Date('2026-11-13T02:20:00Z'),
      affectedEndpoints: ['ep-billing'],
    });

    const advisory = MaintenanceScheduleAdvisorService.evaluateSchedule(candidate, [
      globalWindow,
    ]);

    expect(advisory.hasBlockingOverlap).toBe(true);
    expect(advisory.conflicts[0]?.conflictType).toBe('WILDCARD_OVERLAP');
    expect(advisory.conflicts[0]?.overlappingTargets).toEqual(['ep-billing']);
  });

  it('ignora ventanas canceladas o sobre endpoints totalmente distintos', () => {
    const cancelled = new MaintenanceWindow({
      id: 'mw-cancelled',
      title: 'Ventana cancelada',
      startTime: baseStart,
      endTime: baseEnd,
      affectedEndpoints: ['ep-api'],
      status: 'CANCELLED',
    });

    const otherEndpoint = new MaintenanceWindow({
      id: 'mw-other',
      title: 'Otro servicio',
      startTime: baseStart,
      endTime: baseEnd,
      affectedEndpoints: ['ep-analytics'],
    });

    const candidate = new MaintenanceWindow({
      id: 'mw-cand',
      title: 'Deploy API',
      startTime: baseStart,
      endTime: baseEnd,
      affectedEndpoints: ['ep-api'],
    });

    const advisory = MaintenanceScheduleAdvisorService.evaluateSchedule(candidate, [
      cancelled,
      otherEndpoint,
    ]);

    expect(advisory.hasBlockingOverlap).toBe(false);
    expect(advisory.conflicts).toHaveLength(0);
  });

  it('alerta por ventanas contiguas dentro del buffer de recuperación (ADJACENT_WINDOW)', () => {
    const existing = new MaintenanceWindow({
      id: 'mw-1',
      title: 'Upgrade Node',
      startTime: new Date('2026-11-13T02:00:00Z'),
      endTime: new Date('2026-11-13T02:20:00Z'),
      affectedEndpoints: ['ep-checkout'],
    });

    const candidate = new MaintenanceWindow({
      id: 'mw-2',
      title: 'Migración índices',
      startTime: new Date('2026-11-13T02:25:00Z'), // Solo 5 min después (< 15 min default)
      endTime: new Date('2026-11-13T02:40:00Z'),
      affectedEndpoints: ['ep-checkout'],
    });

    const advisory = MaintenanceScheduleAdvisorService.evaluateSchedule(candidate, [existing], {
      adjacentBufferMinutes: 15,
    });

    expect(advisory.hasBlockingOverlap).toBe(false);
    expect(advisory.conflicts).toHaveLength(1);
    expect(advisory.conflicts[0]?.conflictType).toBe('ADJACENT_WINDOW');
    expect(advisory.conflicts[0]?.gapMinutes).toBe(5);
    expect(advisory.riskLevel).toBe('MODERATE');
  });

  it('detecta servicios dependientes downstream no cubiertos usando el grafo de topología', () => {
    const nodes: ServiceNode[] = [
      { id: 'db-primary', name: 'Primary DB', tier: 'TIER_0', baseAvailabilityPercentage: 99.95, isHealthy: true },
      { id: 'auth-api', name: 'Auth API', tier: 'TIER_0', baseAvailabilityPercentage: 99.9, isHealthy: true },
      { id: 'web-portal', name: 'Web Portal', tier: 'TIER_1', baseAvailabilityPercentage: 99.9, isHealthy: true },
      { id: 'metrics-svc', name: 'Metrics Reporter', tier: 'TIER_2', baseAvailabilityPercentage: 99.5, isHealthy: true },
    ];
    const edges: DependencyEdge[] = [
      { sourceServiceId: 'auth-api', targetServiceId: 'db-primary', type: 'HARD' },
      { sourceServiceId: 'web-portal', targetServiceId: 'auth-api', type: 'HARD' },
      { sourceServiceId: 'metrics-svc', targetServiceId: 'db-primary', type: 'SOFT' },
    ];

    const candidate = new MaintenanceWindow({
      id: 'mw-db',
      title: 'Vacuum Full Primary DB',
      startTime: baseStart,
      endTime: baseEnd,
      affectedEndpoints: ['db-primary'],
    });

    const advisory = MaintenanceScheduleAdvisorService.evaluateSchedule(candidate, [], {
      topologyNodes: nodes,
      topologyEdges: edges,
    });

    expect(advisory.topologyImpact.missingDownstreamServiceIds).toContain('auth-api');
    expect(advisory.topologyImpact.missingDownstreamServiceIds).toContain('web-portal');
    expect(advisory.topologyImpact.missingDegradedServiceIds).toContain('metrics-svc');
    expect(advisory.riskLevel).toBe('CRITICAL');
    expect(advisory.recommendations.some((r) => r.includes('auth-api'))).toBe(true);
  });

  it('advierte cuando la duración excede el Error Budget mensual del SLO objetivo', () => {
    // 60 min > 43.2 min permitidos al 99.9% en 30 días
    const longWindow = new MaintenanceWindow({
      id: 'mw-long',
      title: 'Reemplazo de clúster completo',
      startTime: new Date('2026-11-13T01:00:00Z'),
      endTime: new Date('2026-11-13T02:00:00Z'),
      affectedEndpoints: ['ep-core'],
    });

    const advisory = MaintenanceScheduleAdvisorService.evaluateSchedule(longWindow, [], {
      targetSloPercentage: 99.9,
      sloWindowDays: 30,
    });

    expect(advisory.errorBudgetProtection.exceedsMonthlyErrorBudget).toBe(true);
    expect(advisory.errorBudgetProtection.protectedErrorBudgetPercentage).toBeGreaterThan(100);
    expect(advisory.riskLevel).toBe('HIGH');
  });
});
