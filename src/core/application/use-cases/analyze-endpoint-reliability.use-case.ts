import { IEndpointRepository } from '../../domain/ports/endpoint.repository';
import { IHealthCheckRepository } from '../../domain/ports/health-check.repository';
import { IIncidentRepository } from '../../domain/ports/incident.repository';
import { IMaintenanceWindowRepository } from '../../domain/ports/maintenance-window.repository';
import { MaintenanceWindow } from '../../domain/entities/maintenance-window.entity';
import { HealthCheckResult } from '../../domain/entities/health-check.entity';
import {
  EndpointReliabilityReport,
  IncidentReliabilityService,
} from '../../domain/services/incident-reliability.service';

export interface AnalyzeEndpointReliabilityCommand {
  readonly endpointId: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly targetSloPercentage?: number;
  readonly coalesceGapMinutes?: number;
  readonly flappingThreshold?: number;
  readonly minUnplannedOutageSeconds?: number;
}

export interface MaintenanceAdjustedProbeStats {
  readonly totalProbes: number;
  readonly excludedMaintenanceProbes: number;
  readonly eligibleProbes: number;
  readonly healthyEligibleProbes: number;
  readonly degradedEligibleProbes: number;
  readonly downEligibleProbes: number;
  readonly probeAdjustedAvailabilityPercentage: number;
}

export interface AdjustedErrorBudgetSnapshot {
  readonly targetSloPercentage: number;
  readonly allowedUnplannedDowntimeMinutes: number;
  readonly consumedUnplannedDowntimeMinutes: number;
  readonly remainingErrorBudgetMinutes: number;
  readonly remainingErrorBudgetPercentage: number;
  readonly isSloCompliant: boolean;
  readonly wasSavedByMaintenanceExclusion: boolean;
}

export interface EndpointReliabilityAnalysisResult {
  readonly endpointId: string;
  readonly endpointName: string;
  readonly targetUrl: string;
  readonly reliability: EndpointReliabilityReport;
  readonly errorBudget: AdjustedErrorBudgetSnapshot;
  readonly probeStats: MaintenanceAdjustedProbeStats | null;
}

/**
 * Caso de Uso de Aplicación que orquesta el análisis histórico de confiabilidad SRE
 * de un endpoint: coalescencia de incidentes, histéresis anti-flapping, sustracción de
 * ventanas de mantenimiento programado, MTTD/MTTA/MTTR y cumplimiento ajustado de SLO.
 */
export class AnalyzeEndpointReliabilityUseCase {
  constructor(
    private readonly endpointRepo: IEndpointRepository,
    private readonly incidentRepo: IIncidentRepository,
    private readonly maintenanceWindowRepo: IMaintenanceWindowRepository,
    private readonly healthCheckRepo?: IHealthCheckRepository,
    private readonly reliabilityService: IncidentReliabilityService = new IncidentReliabilityService()
  ) {}

  public async execute(
    command: AnalyzeEndpointReliabilityCommand
  ): Promise<EndpointReliabilityAnalysisResult> {
    const endpoint = await this.endpointRepo.findById(command.endpointId);
    if (!endpoint) {
      throw new Error(`Endpoint no encontrado: ${command.endpointId}`);
    }

    const targetSlo = command.targetSloPercentage ?? 99.9;
    if (!Number.isFinite(targetSlo) || targetSlo <= 0 || targetSlo >= 100) {
      throw new Error('El porcentaje objetivo de SLO debe ubicarse en el rango (0, 100)');
    }

    const [incidents, maintenanceWindows] = await Promise.all([
      this.incidentRepo.findByEndpointId(endpoint.id, 1000),
      this.maintenanceWindowRepo.findOverlappingRange({
        from: command.windowStart,
        to: command.windowEnd,
        endpointId: endpoint.id,
      }),
    ]);

    const reliability = this.reliabilityService.evaluate(incidents, maintenanceWindows, {
      endpointId: endpoint.id,
      windowStart: command.windowStart,
      windowEnd: command.windowEnd,
      coalesceGapMinutes: command.coalesceGapMinutes,
      flappingThreshold: command.flappingThreshold,
      minUnplannedOutageSeconds: command.minUnplannedOutageSeconds,
      probeIntervalSeconds: endpoint.intervalSeconds,
      consecutiveFailuresThreshold: endpoint.consecutiveFailuresThreshold,
    });

    const errorBudget = this.computeAdjustedErrorBudget(reliability, targetSlo);

    let probeStats: MaintenanceAdjustedProbeStats | null = null;
    if (this.healthCheckRepo) {
      const checks = await this.healthCheckRepo.findHistory({
        endpointId: endpoint.id,
        from: command.windowStart,
        to: command.windowEnd,
      });
      probeStats = this.computeMaintenanceFilteredProbeStats(
        checks,
        maintenanceWindows,
        endpoint.id
      );
    }

    return {
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      targetUrl: endpoint.url.value,
      reliability,
      errorBudget,
      probeStats,
    };
  }

  private computeAdjustedErrorBudget(
    reliability: EndpointReliabilityReport,
    targetSloPercentage: number
  ): AdjustedErrorBudgetSnapshot {
    const allowedErrorFraction = (100 - targetSloPercentage) / 100;
    const allowedUnplannedDowntimeMinutes = Number(
      (reliability.eligibleServiceMinutes * allowedErrorFraction).toFixed(2)
    );
    const consumedUnplannedDowntimeMinutes = reliability.effectiveUnplannedDowntimeMinutes;
    const remainingErrorBudgetMinutes = Math.max(
      0,
      Number((allowedUnplannedDowntimeMinutes - consumedUnplannedDowntimeMinutes).toFixed(2))
    );

    const remainingErrorBudgetPercentage =
      allowedUnplannedDowntimeMinutes > 0
        ? Math.max(
            0,
            Math.min(
              100,
              Number(
                ((remainingErrorBudgetMinutes / allowedUnplannedDowntimeMinutes) * 100).toFixed(2)
              )
            )
          )
        : 100;

    const isSloCompliant = reliability.adjustedUptimePercentage >= targetSloPercentage;
    const wasSavedByMaintenanceExclusion =
      reliability.rawUptimePercentage < targetSloPercentage && isSloCompliant;

    return {
      targetSloPercentage,
      allowedUnplannedDowntimeMinutes,
      consumedUnplannedDowntimeMinutes,
      remainingErrorBudgetMinutes,
      remainingErrorBudgetPercentage,
      isSloCompliant,
      wasSavedByMaintenanceExclusion,
    };
  }

  private computeMaintenanceFilteredProbeStats(
    checks: readonly HealthCheckResult[],
    maintenanceWindows: readonly MaintenanceWindow[],
    endpointId: string
  ): MaintenanceAdjustedProbeStats {
    let excludedMaintenanceProbes = 0;
    let healthyEligibleProbes = 0;
    let degradedEligibleProbes = 0;
    let downEligibleProbes = 0;

    for (const check of checks) {
      const coveredByMaintenance = maintenanceWindows.some((win) =>
        win.containsTimestamp(check.timestamp, endpointId)
      );

      if (coveredByMaintenance) {
        excludedMaintenanceProbes += 1;
        continue;
      }

      if (check.isFailed()) {
        downEligibleProbes += 1;
      } else if (check.isDegraded()) {
        degradedEligibleProbes += 1;
      } else if (check.isSuccess()) {
        healthyEligibleProbes += 1;
      }
    }

    const eligibleProbes =
      healthyEligibleProbes + degradedEligibleProbes + downEligibleProbes;

    const weightedSuccess = healthyEligibleProbes + degradedEligibleProbes * 0.5;
    const probeAdjustedAvailabilityPercentage =
      eligibleProbes > 0
        ? Number(((weightedSuccess / eligibleProbes) * 100).toFixed(4))
        : 100;

    return {
      totalProbes: checks.length,
      excludedMaintenanceProbes,
      eligibleProbes,
      healthyEligibleProbes,
      degradedEligibleProbes,
      downEligibleProbes,
      probeAdjustedAvailabilityPercentage,
    };
  }
}
