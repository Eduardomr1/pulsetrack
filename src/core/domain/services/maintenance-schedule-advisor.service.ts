import { MaintenanceWindow } from '../entities/maintenance-window.entity';
import {
  DependencyEdge,
  ServiceNode,
} from '../entities/service-dependency.entity';
import { ServiceDependencyTopologyService } from './service-dependency-topology.service';

export type MaintenanceConflictType =
  | 'DIRECT_OVERLAP'
  | 'WILDCARD_OVERLAP'
  | 'ADJACENT_WINDOW';

export interface MaintenanceConflict {
  readonly existingWindowId: string;
  readonly existingWindowTitle: string;
  readonly conflictType: MaintenanceConflictType;
  readonly overlapMinutes: number;
  readonly gapMinutes: number;
  readonly overlappingTargets: readonly string[];
  readonly description: string;
}

export interface MaintenanceTopologyImpact {
  readonly coveredTargets: readonly string[];
  readonly missingDownstreamServiceIds: readonly string[];
  readonly missingDegradedServiceIds: readonly string[];
  readonly maxBlastRadiusScore: number;
}

export interface ErrorBudgetProtectionSummary {
  readonly targetSloPercentage: number;
  readonly sloWindowDays: number;
  readonly totalAllowedBudgetMinutes: number;
  readonly windowDurationMinutes: number;
  readonly protectedErrorBudgetPercentage: number;
  readonly exceedsMonthlyErrorBudget: boolean;
}

export type MaintenanceRiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export interface MaintenanceScheduleAdvisoryOptions {
  readonly adjacentBufferMinutes?: number;
  readonly targetSloPercentage?: number;
  readonly sloWindowDays?: number;
  readonly topologyNodes?: readonly ServiceNode[];
  readonly topologyEdges?: readonly DependencyEdge[];
}

export interface MaintenanceScheduleAdvisory {
  readonly proposedWindowId: string;
  readonly durationMinutes: number;
  readonly riskLevel: MaintenanceRiskLevel;
  readonly hasBlockingOverlap: boolean;
  readonly conflicts: readonly MaintenanceConflict[];
  readonly topologyImpact: MaintenanceTopologyImpact;
  readonly errorBudgetProtection: ErrorBudgetProtectionSummary;
  readonly recommendations: readonly string[];
}

/**
 * Servicio de Dominio encargado de auditar la programación de ventanas de mantenimiento:
 * - Detecta colisiones temporales y ventanas adyacentes sobre endpoints compartidos o wildcard (`*`).
 * - Calcula el radio de explosión sobre la topología de dependencias para sugerir servicios dependientes faltantes.
 * - Estima el presupuesto de error (Error Budget SLO) protegido al formalizar la ventana.
 */
export class MaintenanceScheduleAdvisorService {
  public static evaluateSchedule(
    candidate: MaintenanceWindow,
    existingWindows: readonly MaintenanceWindow[],
    options: MaintenanceScheduleAdvisoryOptions = {}
  ): MaintenanceScheduleAdvisory {
    const bufferMinutes = Math.max(0, options.adjacentBufferMinutes ?? 15);
    const targetSlo = options.targetSloPercentage ?? 99.9;
    const sloDays = Math.max(1, options.sloWindowDays ?? 30);

    const conflicts = this.detectConflicts(candidate, existingWindows, bufferMinutes);
    const topologyImpact = this.analyzeTopologyCoverage(
      candidate,
      options.topologyNodes ?? [],
      options.topologyEdges ?? []
    );
    const errorBudgetProtection = this.computeErrorBudgetProtection(
      candidate,
      targetSlo,
      sloDays
    );

    const hasBlockingOverlap = conflicts.some(
      (c) => c.conflictType === 'DIRECT_OVERLAP' || c.conflictType === 'WILDCARD_OVERLAP'
    );

    const riskLevel = this.classifyRiskLevel(
      hasBlockingOverlap,
      conflicts,
      topologyImpact,
      errorBudgetProtection
    );

    const recommendations = this.buildRecommendations(
      candidate,
      conflicts,
      topologyImpact,
      errorBudgetProtection
    );

    return {
      proposedWindowId: candidate.id,
      durationMinutes: candidate.getDurationMinutes(),
      riskLevel,
      hasBlockingOverlap,
      conflicts,
      topologyImpact,
      errorBudgetProtection,
      recommendations,
    };
  }

  private static detectConflicts(
    candidate: MaintenanceWindow,
    existingWindows: readonly MaintenanceWindow[],
    bufferMinutes: number
  ): MaintenanceConflict[] {
    const conflicts: MaintenanceConflict[] = [];
    const candStart = candidate.startTime.getTime();
    const candEnd = candidate.endTime.getTime();

    for (const existing of existingWindows) {
      if (existing.id === candidate.id || !existing.isEffective()) {
        continue;
      }

      const overlappingTargets = this.findOverlappingTargets(candidate, existing);
      if (overlappingTargets.length === 0) {
        continue;
      }

      const exStart = existing.startTime.getTime();
      const exEnd = existing.endTime.getTime();

      const overlapMs = Math.max(0, Math.min(candEnd, exEnd) - Math.max(candStart, exStart));
      const isWildcardInvolvement =
        candidate.affectedEndpoints.includes('*') || existing.affectedEndpoints.includes('*');

      if (overlapMs > 0) {
        const overlapMinutes = Number((overlapMs / 60_000).toFixed(2));
        const conflictType: MaintenanceConflictType = isWildcardInvolvement
          ? 'WILDCARD_OVERLAP'
          : 'DIRECT_OVERLAP';

        conflicts.push({
          existingWindowId: existing.id,
          existingWindowTitle: existing.title,
          conflictType,
          overlapMinutes,
          gapMinutes: 0,
          overlappingTargets,
          description: `Solapamiento de ${overlapMinutes} min con "${existing.title}" sobre [${overlappingTargets.join(', ')}].`,
        });
        continue;
      }

      // Calcular distancia entre ventanas disjuntas para detectar riesgo por contigüidad
      const gapMs = candEnd <= exStart ? exStart - candEnd : candStart - exEnd;
      const gapMinutes = Number((gapMs / 60_000).toFixed(2));

      if (bufferMinutes > 0 && gapMinutes < bufferMinutes) {
        conflicts.push({
          existingWindowId: existing.id,
          existingWindowTitle: existing.title,
          conflictType: 'ADJACENT_WINDOW',
          overlapMinutes: 0,
          gapMinutes,
          overlappingTargets,
          description: `Ventana contigua a solo ${gapMinutes} min de "${existing.title}" (< buffer SRE de ${bufferMinutes} min).`,
        });
      }
    }

    return conflicts;
  }

  private static findOverlappingTargets(
    a: MaintenanceWindow,
    b: MaintenanceWindow
  ): string[] {
    const aWildcard = a.affectedEndpoints.includes('*');
    const bWildcard = b.affectedEndpoints.includes('*');

    if (aWildcard && bWildcard) return ['*'];
    if (aWildcard) return [...b.affectedEndpoints];
    if (bWildcard) return [...a.affectedEndpoints];

    const bSet = new Set(b.affectedEndpoints);
    return a.affectedEndpoints.filter((target) => bSet.has(target));
  }

  private static analyzeTopologyCoverage(
    candidate: MaintenanceWindow,
    nodes: readonly ServiceNode[],
    edges: readonly DependencyEdge[]
  ): MaintenanceTopologyImpact {
    if (candidate.affectedEndpoints.includes('*') || nodes.length === 0) {
      return {
        coveredTargets: candidate.affectedEndpoints,
        missingDownstreamServiceIds: [],
        missingDegradedServiceIds: [],
        maxBlastRadiusScore: 0,
      };
    }

    const declaredTargets = new Set(candidate.affectedEndpoints);
    const missingUnreachable = new Set<string>();
    const missingDegraded = new Set<string>();
    let maxBlastRadiusScore = 0;

    for (const targetId of candidate.affectedEndpoints) {
      const blast = ServiceDependencyTopologyService.calculateBlastRadius(
        targetId,
        nodes,
        edges
      );
      maxBlastRadiusScore = Math.max(maxBlastRadiusScore, blast.blastRadiusScore);

      for (const id of blast.unreachableServiceIds) {
        if (!declaredTargets.has(id)) {
          missingUnreachable.add(id);
        }
      }
      for (const id of blast.degradedServiceIds) {
        if (!declaredTargets.has(id) && !missingUnreachable.has(id)) {
          missingDegraded.add(id);
        }
      }
    }

    return {
      coveredTargets: candidate.affectedEndpoints,
      missingDownstreamServiceIds: Array.from(missingUnreachable),
      missingDegradedServiceIds: Array.from(missingDegraded),
      maxBlastRadiusScore,
    };
  }

  private static computeErrorBudgetProtection(
    candidate: MaintenanceWindow,
    targetSloPercentage: number,
    sloWindowDays: number
  ): ErrorBudgetProtectionSummary {
    const totalWindowMinutes = sloWindowDays * 24 * 60;
    const allowedFraction = Math.max(0, (100 - targetSloPercentage) / 100);
    const totalAllowedBudgetMinutes = Number((totalWindowMinutes * allowedFraction).toFixed(2));
    const windowDurationMinutes = candidate.getDurationMinutes();

    const protectedErrorBudgetPercentage =
      totalAllowedBudgetMinutes > 0
        ? Number(((windowDurationMinutes / totalAllowedBudgetMinutes) * 100).toFixed(1))
        : 0;

    return {
      targetSloPercentage,
      sloWindowDays,
      totalAllowedBudgetMinutes,
      windowDurationMinutes,
      protectedErrorBudgetPercentage,
      exceedsMonthlyErrorBudget:
        totalAllowedBudgetMinutes > 0 && windowDurationMinutes > totalAllowedBudgetMinutes,
    };
  }

  private static classifyRiskLevel(
    hasBlockingOverlap: boolean,
    conflicts: readonly MaintenanceConflict[],
    topology: MaintenanceTopologyImpact,
    budget: ErrorBudgetProtectionSummary
  ): MaintenanceRiskLevel {
    if (
      (hasBlockingOverlap && topology.missingDownstreamServiceIds.length > 0) ||
      topology.maxBlastRadiusScore >= 70 ||
      (budget.exceedsMonthlyErrorBudget && topology.missingDownstreamServiceIds.length > 0)
    ) {
      return 'CRITICAL';
    }

    if (
      hasBlockingOverlap ||
      topology.missingDownstreamServiceIds.length > 0 ||
      budget.exceedsMonthlyErrorBudget
    ) {
      return 'HIGH';
    }

    if (
      conflicts.length > 0 ||
      topology.missingDegradedServiceIds.length > 0 ||
      budget.protectedErrorBudgetPercentage >= 35
    ) {
      return 'MODERATE';
    }

    return 'LOW';
  }

  private static buildRecommendations(
    candidate: MaintenanceWindow,
    conflicts: readonly MaintenanceConflict[],
    topology: MaintenanceTopologyImpact,
    budget: ErrorBudgetProtectionSummary
  ): string[] {
    const recommendations: string[] = [];

    for (const conflict of conflicts) {
      if (conflict.conflictType === 'ADJACENT_WINDOW') {
        recommendations.push(
          `Incrementar el margen de recuperación respecto a "${conflict.existingWindowTitle}" (separación actual: ${conflict.gapMinutes} min) para verificar estabilidad post-despliegue.`
        );
      } else {
        recommendations.push(
          `Coordinar o consolidar ventana con "${conflict.existingWindowTitle}": existe solapamiento de ${conflict.overlapMinutes} min en [${conflict.overlappingTargets.join(', ')}].`
        );
      }
    }

    if (topology.missingDownstreamServiceIds.length > 0) {
      recommendations.push(
        `Incluir en affectedEndpoints los servicios con dependencia crítica sin fallback (${topology.missingDownstreamServiceIds.join(', ')}) para evitar alertas en cascada.`
      );
    }

    if (topology.missingDegradedServiceIds.length > 0) {
      recommendations.push(
        `Notificar a los propietarios de servicios degradables (${topology.missingDegradedServiceIds.join(', ')}) sobre degradación controlada durante el cambio.`
      );
    }

    if (budget.exceedsMonthlyErrorBudget) {
      recommendations.push(
        `La duración (${candidate.getDurationMinutes()} min) excede el Error Budget mensual (${budget.totalAllowedBudgetMinutes} min para SLO ${budget.targetSloPercentage}%); ejecutar en lotes o canary rollout.`
      );
    }

    if (recommendations.length === 0) {
      recommendations.push(
        'Ventana libre de conflictos y con cobertura topológica consistente; lista para programar.'
      );
    }

    return recommendations;
  }
}
