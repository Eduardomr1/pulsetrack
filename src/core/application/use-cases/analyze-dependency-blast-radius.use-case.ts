import {
  CascadingImpactSummary,
  DependencyEdge,
  ServiceNode,
} from '../../domain/entities/service-dependency.entity';
import {
  ServiceDependencyTopologyService,
  SinglePointOfFailureInfo,
} from '../../domain/services/service-dependency-topology.service';

export interface AnalyzeDependencyBlastRadiusCommand {
  readonly targetServiceId: string;
  readonly nodes: readonly ServiceNode[];
  readonly edges: readonly DependencyEdge[];
  readonly simulateCascadingFailure?: boolean;
}

export interface DependencyBlastRadiusAnalysisResult {
  readonly evaluatedAt: string;
  readonly targetServiceId: string;
  readonly targetServiceName: string;
  readonly isTopologyValid: boolean;
  readonly topologyErrors: readonly string[];
  readonly detectedCycles: readonly (readonly string[])[];
  readonly blastRadius: CascadingImpactSummary;
  readonly systemSpofs: readonly SinglePointOfFailureInfo[];
  readonly preIncidentCompositeAvailabilityPercentage: number;
  readonly postIncidentCompositeAvailabilityPercentage: number;
  readonly executiveSummary: string;
}

/**
 * Caso de Uso que orquesta el análisis de impacto y radio de explosión (Blast Radius)
 * ante caídas de dependencias en arquitecturas distribuidas, detectando puntos únicos de falla
 * y recomendando mitigaciones SRE automatizadas.
 */
export class AnalyzeDependencyBlastRadiusUseCase {
  public execute(command: AnalyzeDependencyBlastRadiusCommand): DependencyBlastRadiusAnalysisResult {
    const { targetServiceId, nodes, edges } = command;

    const validation = ServiceDependencyTopologyService.validateTopology(nodes, edges);
    const targetNode = nodes.find((n) => n.id === targetServiceId);
    const targetName = targetNode ? targetNode.name : targetServiceId;

    const blastRadius = ServiceDependencyTopologyService.calculateBlastRadius(targetServiceId, nodes, edges);
    const systemSpofs = ServiceDependencyTopologyService.findSinglePointsOfFailure(nodes, edges);

    // Calcular disponibilidad antes de la falla
    const preIncidentAvail = ServiceDependencyTopologyService.calculateCompositeAvailability(
      targetServiceId,
      nodes,
      edges
    );

    // Simular degradación después de la falla
    const simulatedNodes = nodes.map((n) =>
      n.id === targetServiceId ? { ...n, isHealthy: false, baseAvailabilityPercentage: 0 } : n
    );
    const postIncidentAvail = ServiceDependencyTopologyService.calculateCompositeAvailability(
      targetServiceId,
      simulatedNodes,
      edges
    );

    const severityLabel =
      blastRadius.blastRadiusScore >= 75
        ? 'CRÍTICO'
        : blastRadius.blastRadiusScore >= 40
        ? 'MODERADO'
        : 'BAJO';

    const executiveSummary =
      `Análisis SRE de Blast Radius para "${targetName}": Impacto ${severityLabel} (${blastRadius.blastRadiusScore}/100). ` +
      `${blastRadius.unreachableServiceIds.length} servicio(s) inalcanzables, ${blastRadius.degradedServiceIds.length} degradado(s). ` +
      `Se identificaron ${systemSpofs.length} Puntos Únicos de Falla en la topología analizada.`;

    return {
      evaluatedAt: new Date().toISOString(),
      targetServiceId,
      targetServiceName: targetName,
      isTopologyValid: validation.isValid,
      topologyErrors: validation.errors,
      detectedCycles: validation.cycles,
      blastRadius,
      systemSpofs,
      preIncidentCompositeAvailabilityPercentage: preIncidentAvail,
      postIncidentCompositeAvailabilityPercentage: postIncidentAvail,
      executiveSummary,
    };
  }
}
