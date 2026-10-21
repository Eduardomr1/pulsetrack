import { describe, it, expect } from 'vitest';
import { Incident } from '../entities/incident.entity';
import { MaintenanceWindow } from '../entities/maintenance-window.entity';
import { IncidentReliabilityService } from './incident-reliability.service';

describe('MaintenanceWindow & IncidentReliabilityService', () => {
  describe('MaintenanceWindow (invariantes e intersección de intervalos)', () => {
    it('valida invariantes de título obligatorio y orden cronológico estricto', () => {
      const start = new Date('2026-10-21T02:00:00Z');
      const end = new Date('2026-10-21T03:00:00Z');

      expect(
        () =>
          new MaintenanceWindow({
            id: 'mw-1',
            title: '   ',
            startTime: start,
            endTime: end,
          })
      ).toThrow('título de la ventana de mantenimiento no puede estar vacío');

      expect(
        () =>
          new MaintenanceWindow({
            id: 'mw-2',
            title: 'Migración DB',
            startTime: end,
            endTime: start,
          })
      ).toThrow('estrictamente posterior al inicio');
    });

    it('evalúa estado dinámico, comodín "*" y cancelación de ventanas', () => {
      const win = new MaintenanceWindow({
        id: 'mw-global',
        title: 'Actualización de Kernel en Nodos Edge',
        startTime: new Date('2026-10-21T04:00:00Z'),
        endTime: new Date('2026-10-21T05:00:00Z'),
        affectedEndpoints: ['*'],
      });

      expect(win.appliesToEndpoint('ep-any')).toBe(true);
      expect(win.getDynamicStatus(new Date('2026-10-21T03:30:00Z'))).toBe('SCHEDULED');
      expect(win.getDynamicStatus(new Date('2026-10-21T04:30:00Z'))).toBe('IN_PROGRESS');
      expect(win.getDynamicStatus(new Date('2026-10-21T05:01:00Z'))).toBe('COMPLETED');

      win.cancel();
      expect(win.isEffective()).toBe(false);
      expect(win.appliesToEndpoint('ep-any')).toBe(false);
      expect(
        win.computeOverlapMs(
          new Date('2026-10-21T04:00:00Z'),
          new Date('2026-10-21T05:00:00Z'),
          'ep-any'
        )
      ).toBe(0);
    });

    it('une ventanas de mantenimiento solapadas y anidadas sin doble sustracción', () => {
      // Ventana A: 01:00 - 02:00 (60m)
      // Ventana B (solapada): 01:30 - 02:30 (extiende 30m -> total 90m)
      // Ventana C (anidada): 01:40 - 01:55 (0m adicionales)
      // Ventana D (otro endpoint): 03:00 - 04:00 (ignorada para ep-api)
      const windows = [
        new MaintenanceWindow({
          id: 'mw-a',
          title: 'Upgrade A',
          startTime: new Date('2026-10-21T01:00:00Z'),
          endTime: new Date('2026-10-21T02:00:00Z'),
          affectedEndpoints: ['ep-api'],
        }),
        new MaintenanceWindow({
          id: 'mw-b',
          title: 'Upgrade B',
          startTime: new Date('2026-10-21T01:30:00Z'),
          endTime: new Date('2026-10-21T02:30:00Z'),
          affectedEndpoints: ['*'],
        }),
        new MaintenanceWindow({
          id: 'mw-c',
          title: 'Nested C',
          startTime: new Date('2026-10-21T01:40:00Z'),
          endTime: new Date('2026-10-21T01:55:00Z'),
          affectedEndpoints: ['ep-api'],
        }),
        new MaintenanceWindow({
          id: 'mw-d',
          title: 'Other Service D',
          startTime: new Date('2026-10-21T03:00:00Z'),
          endTime: new Date('2026-10-21T04:00:00Z'),
          affectedEndpoints: ['ep-billing'],
        }),
      ];

      const mergedMs = MaintenanceWindow.computeMergedOverlapMs(
        windows,
        new Date('2026-10-21T00:00:00Z'),
        new Date('2026-10-21T06:00:00Z'),
        'ep-api'
      );

      // Exactamente 90 minutos = 5,400,000 ms
      expect(mergedMs).toBe(90 * 60_000);
    });
  });

  describe('IncidentReliabilityService (coalescencia, flapping y uptime ajustado)', () => {
    const service = new IncidentReliabilityService();

    it('coalesce micro-cortes dentro de la brecha de histéresis y detecta flapping con promoción de severidad', () => {
      const windowStart = new Date('2026-10-21T00:00:00Z');
      const windowEnd = new Date('2026-10-21T12:00:00Z'); // 720 min

      // 3 micro-cortes separados por 3 min y 4 min (<= 5 min coalesceGapMinutes):
      // 1) 02:00 - 02:04 (4m, WARNING)
      // 2) 02:07 - 02:10 (3m, CRITICAL, ack 02:08)
      // 3) 02:14 - 02:16 (2m, INFO)
      // Y un 4to incidente separado por 44 min (> 5 min):
      // 4) 03:00 - 03:10 (10m, WARNING, ack 03:02)
      const incidents = [
        new Incident({
          id: 'inc-1',
          endpointId: 'ep-checkout',
          status: 'RESOLVED',
          severity: 'WARNING',
          startedAt: new Date('2026-10-21T02:00:00Z'),
          resolvedAt: new Date('2026-10-21T02:04:00Z'),
          summary: 'Latencia elevada y errores HTTP 502 intermitentes',
          consecutiveFailures: 3,
        }),
        new Incident({
          id: 'inc-2',
          endpointId: 'ep-checkout',
          status: 'RESOLVED',
          severity: 'CRITICAL',
          startedAt: new Date('2026-10-21T02:07:00Z'),
          acknowledgedAt: new Date('2026-10-21T02:08:00Z'),
          resolvedAt: new Date('2026-10-21T02:10:00Z'),
          summary: 'Connection refused en upstream pod',
          rootCause: 'CrashLoopBackOff por OOMKilled en réplica primaria',
          consecutiveFailures: 5,
        }),
        new Incident({
          id: 'inc-3',
          endpointId: 'ep-checkout',
          status: 'RESOLVED',
          severity: 'INFO',
          startedAt: new Date('2026-10-21T02:14:00Z'),
          resolvedAt: new Date('2026-10-21T02:16:00Z'),
          summary: 'Réplica reiniciando',
          consecutiveFailures: 2,
        }),
        new Incident({
          id: 'inc-4',
          endpointId: 'ep-checkout',
          status: 'RESOLVED',
          severity: 'WARNING',
          startedAt: new Date('2026-10-21T03:00:00Z'),
          acknowledgedAt: new Date('2026-10-21T03:02:00Z'),
          resolvedAt: new Date('2026-10-21T03:10:00Z'),
          summary: 'Timeout aislado de red',
          consecutiveFailures: 3,
        }),
      ];

      const report = service.evaluate(incidents, [], {
        endpointId: 'ep-checkout',
        windowStart,
        windowEnd,
        coalesceGapMinutes: 5,
        flappingThreshold: 3,
        probeIntervalSeconds: 20,
        consecutiveFailuresThreshold: 3,
      });

      expect(report.totalRawIncidents).toBe(4);
      expect(report.coalescedEpisodesCount).toBe(2);
      expect(report.flappingEpisodesCount).toBe(1);

      const firstEp = report.episodes[0];
      expect(firstEp).toBeDefined();
      expect(firstEp?.subIncidentIds).toEqual(['inc-1', 'inc-2', 'inc-3']);
      expect(firstEp?.isFlapping).toBe(true);
      expect(firstEp?.flapCount).toBe(3);
      expect(firstEp?.severity).toBe('CRITICAL');
      expect(firstEp?.wallClockDurationMinutes).toBe(16); // 02:00 -> 02:16
      expect(firstEp?.rawOutageMinutes).toBe(9); // 4 + 3 + 2
      expect(firstEp?.interFlapRecoveryMinutes).toBe(7); // 3 + 4
      expect(firstEp?.totalConsecutiveFailures).toBe(10); // 3 + 5 + 2
      expect(firstEp?.rootCause).toBe('CrashLoopBackOff por OOMKilled en réplica primaria');
      expect(firstEp?.timeToAcknowledgeMinutes).toBe(8); // 02:08 - 02:00

      // Total downtime: 9m + 10m = 19m sobre 720m -> 97.3611%
      expect(report.effectiveUnplannedDowntimeMinutes).toBe(19);
      expect(report.meanTimeToDetectSeconds).toBe(60); // 20s * 3
      expect(report.meanTimeToAcknowledgeMinutes).toBe(5); // (8 + 2) / 2
      expect(report.meanTimeToResolveMinutes).toBe(9.5); // (9 + 10) / 2
    });

    it('excluye caídas cubiertas total o parcialmente por ventanas de mantenimiento programado', () => {
      // Ventana total: 24 horas = 1440 min
      const windowStart = new Date('2026-10-21T00:00:00Z');
      const windowEnd = new Date('2026-10-22T00:00:00Z');

      // Mantenimiento programado: 01:00 a 02:00 (60 min) -> tiempo elegible = 1380 min
      const maintenance = [
        new MaintenanceWindow({
          id: 'mw-db-patch',
          title: 'Actualización de motor PostgreSQL',
          startTime: new Date('2026-10-21T01:00:00Z'),
          endTime: new Date('2026-10-21T02:00:00Z'),
          affectedEndpoints: ['ep-core'],
        }),
      ];

      // Incidente A: 01:10 - 01:40 (30 min, 100% dentro de mantenimiento)
      // Incidente B: 01:45 - 02:15 (30 min, 15 min dentro de mantenimiento + 15 min overrun no planificado)
      const incidents = [
        new Incident({
          id: 'inc-maint-full',
          endpointId: 'ep-core',
          status: 'RESOLVED',
          severity: 'CRITICAL',
          startedAt: new Date('2026-10-21T01:10:00Z'),
          resolvedAt: new Date('2026-10-21T01:40:00Z'),
          summary: 'Reinicio esperado de instancia primaria',
          consecutiveFailures: 10,
        }),
        new Incident({
          id: 'inc-maint-overrun',
          endpointId: 'ep-core',
          status: 'RESOLVED',
          severity: 'WARNING',
          startedAt: new Date('2026-10-21T01:45:00Z'),
          resolvedAt: new Date('2026-10-21T02:15:00Z'),
          summary: 'Demora en calentamiento de caché post-mantenimiento',
          consecutiveFailures: 6,
        }),
      ];

      const report = service.evaluate(incidents, maintenance, {
        endpointId: 'ep-core',
        windowStart,
        windowEnd,
        coalesceGapMinutes: 2, // brecha 5m > 2m para mantenerlos separados y verificar clasificación individual
      });

      expect(report.scheduledMaintenanceMinutes).toBe(60);
      expect(report.eligibleServiceMinutes).toBe(1380);
      expect(report.rawDowntimeMinutes).toBe(60); // 30 + 30
      expect(report.excludedMaintenanceDowntimeMinutes).toBe(45); // 30 + 15
      expect(report.effectiveUnplannedDowntimeMinutes).toBe(15);

      expect(report.episodes[0]?.maintenanceCoverage).toBe('FULLY_COVERED_BY_MAINTENANCE');
      expect(report.episodes[0]?.countsTowardSlaBreach).toBe(false);

      expect(report.episodes[1]?.maintenanceCoverage).toBe('PARTIALLY_EXCLUDED');
      expect(report.episodes[1]?.excludedMaintenanceMinutes).toBe(15);
      expect(report.episodes[1]?.unplannedOutageMinutes).toBe(15);
      expect(report.episodes[1]?.countsTowardSlaBreach).toBe(true);

      // Raw uptime: (1440 - 60) / 1440 = 95.8333%
      // Adjusted uptime: (1380 - 15) / 1380 = 98.9130%
      expect(report.rawUptimePercentage).toBeCloseTo(95.8333, 3);
      expect(report.adjustedUptimePercentage).toBeCloseTo(98.913, 3);
      expect(report.maintenanceCoveredEpisodesCount).toBe(1);
      expect(report.unplannedEpisodesCount).toBe(1);
    });

    it('suprime micro-cortes fugaces bajo el umbral de histéresis minUnplannedOutageSeconds y recorta incidentes abiertos', () => {
      const windowStart = new Date('2026-10-21T10:00:00Z');
      const windowEnd = new Date('2026-10-21T11:00:00Z'); // 60 min

      const incidents = [
        // Blip fugaz de 30 segundos (< 60s umbral)
        new Incident({
          id: 'inc-blip',
          endpointId: 'ep-auth',
          status: 'RESOLVED',
          severity: 'INFO',
          startedAt: new Date('2026-10-21T10:05:00Z'),
          resolvedAt: new Date('2026-10-21T10:05:30Z'),
          summary: 'Reconexión TLS transitoria',
          consecutiveFailures: 1,
        }),
        // Incidente aún abierto al cierre de la ventana (10:50 -> recortado a 11:00 = 10 min)
        new Incident({
          id: 'inc-open',
          endpointId: 'ep-auth',
          status: 'INVESTIGATING',
          severity: 'CRITICAL',
          startedAt: new Date('2026-10-21T10:50:00Z'),
          acknowledgedAt: new Date('2026-10-21T10:52:00Z'),
          resolvedAt: null,
          summary: 'Caída activa del clúster OAuth',
          consecutiveFailures: 20,
        }),
      ];

      const report = service.evaluate(incidents, [], {
        endpointId: 'ep-auth',
        windowStart,
        windowEnd,
        minUnplannedOutageSeconds: 60,
      });

      expect(report.suppressedMicroOutagesCount).toBe(1);
      expect(report.suppressedHysteresisDowntimeMinutes).toBe(0.5);
      expect(report.effectiveUnplannedDowntimeMinutes).toBe(10);

      expect(report.episodes[0]?.isSuppressedMicroOutage).toBe(true);
      expect(report.episodes[0]?.countsTowardSlaBreach).toBe(false);

      expect(report.episodes[1]?.isOngoing).toBe(true);
      expect(report.episodes[1]?.effectiveMttrMinutes).toBeNull();
      expect(report.episodes[1]?.unplannedOutageMinutes).toBe(10);
      expect(report.adjustedUptimePercentage).toBeCloseTo(83.3333, 3);
    });
  });
});
