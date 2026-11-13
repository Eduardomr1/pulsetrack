import { randomUUID } from 'node:crypto';
import { MaintenanceWindow } from '../../domain/entities/maintenance-window.entity';
import {
  DependencyEdge,
  ServiceNode,
} from '../../domain/entities/service-dependency.entity';
import { IMaintenanceWindowRepository } from '../../domain/ports/maintenance-window.repository';
import {
  MaintenanceScheduleAdvisorService,
  MaintenanceScheduleAdvisory,
} from '../../domain/services/maintenance-schedule-advisor.service';

export interface ScheduleMaintenanceWindowCommand {
  readonly id?: string;
  readonly title: string;
  readonly description?: string | null;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly affectedEndpoints?: readonly string[];
  readonly targetSloPercentage?: number;
  readonly sloWindowDays?: number;
  readonly adjacentBufferMinutes?: number;
  readonly topologyNodes?: readonly ServiceNode[];
  readonly topologyEdges?: readonly DependencyEdge[];
  readonly rejectOnOverlapConflict?: boolean;
}

export interface ScheduleMaintenanceWindowResult {
  readonly window: MaintenanceWindow;
  readonly advisory: MaintenanceScheduleAdvisory;
}

/**
 * Caso de Uso de Aplicación para validar, auditar colisiones y persistir una
 * ventana de mantenimiento programado mediante el repositorio del dominio.
 */
export class ScheduleMaintenanceWindowUseCase {
  constructor(private readonly maintenanceRepo: IMaintenanceWindowRepository) {}

  public async execute(
    command: ScheduleMaintenanceWindowCommand
  ): Promise<ScheduleMaintenanceWindowResult> {
    const candidate = new MaintenanceWindow({
      id: command.id ?? `maint_${randomUUID()}`,
      title: command.title,
      description: command.description,
      startTime: command.startTime,
      endTime: command.endTime,
      affectedEndpoints: command.affectedEndpoints ?? ['*'],
      status: 'SCHEDULED',
      createdAt: new Date(),
    });

    const bufferMs = Math.max(0, command.adjacentBufferMinutes ?? 15) * 60_000;
    const searchFrom = new Date(candidate.startTime.getTime() - bufferMs);
    const searchTo = new Date(candidate.endTime.getTime() + bufferMs);

    const existingNearby = await this.maintenanceRepo.findOverlappingRange({
      from: searchFrom,
      to: searchTo,
    });

    const advisory = MaintenanceScheduleAdvisorService.evaluateSchedule(
      candidate,
      existingNearby,
      {
        adjacentBufferMinutes: command.adjacentBufferMinutes,
        targetSloPercentage: command.targetSloPercentage,
        sloWindowDays: command.sloWindowDays,
        topologyNodes: command.topologyNodes,
        topologyEdges: command.topologyEdges,
      }
    );

    if (command.rejectOnOverlapConflict && advisory.hasBlockingOverlap) {
      const conflictSummary = advisory.conflicts
        .filter((c) => c.conflictType !== 'ADJACENT_WINDOW')
        .map((c) => c.description)
        .join(' | ');
      throw new Error(
        `Conflicto bloqueante al programar ventana de mantenimiento: ${conflictSummary}`
      );
    }

    await this.maintenanceRepo.save(candidate);

    return {
      window: candidate,
      advisory,
    };
  }
}
