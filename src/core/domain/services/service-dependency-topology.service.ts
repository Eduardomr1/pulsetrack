import {
  CascadingImpactSummary,
  DependencyCriticality,
  DependencyEdge,
  ServiceNode,
} from '../entities/service-dependency.entity';

export interface TopologyValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly cycles: readonly (readonly string[])[];
}

export interface SinglePointOfFailureInfo {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly tier: DependencyCriticality;
  readonly downstreamAffectedCount: number;
  readonly reason: string;
}

export class ServiceDependencyTopologyService {
  /**
   * Valida la integridad referencial y detecta ciclos en la topología de dependencias.
   */
  public static validateTopology(
    nodes: readonly ServiceNode[],
    edges: readonly DependencyEdge[]
  ): TopologyValidationResult {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const errors: string[] = [];

    // Validar nodos duplicados
    const seenIds = new Set<string>();
    for (const node of nodes) {
      if (seenIds.has(node.id)) {
        errors.push(`Identificador de servicio duplicado: "${node.id}"`);
      }
      seenIds.add(node.id);
    }

    // Validar que las aristas apunten a nodos válidos
    for (const edge of edges) {
      if (!nodeIds.has(edge.sourceServiceId)) {
        errors.push(`Arista con origen desconocido: "${edge.sourceServiceId}"`);
      }
      if (!nodeIds.has(edge.targetServiceId)) {
        errors.push(`Arista con destino desconocido: "${edge.targetServiceId}"`);
      }
      if (edge.fallbackServiceId && !nodeIds.has(edge.fallbackServiceId)) {
        errors.push(`Servicio de fallback desconocido: "${edge.fallbackServiceId}"`);
      }
    }

    // Detección de ciclos dirigida (source -> target)
    const adjacency = new Map<string, string[]>();
    for (const id of nodeIds) {
      adjacency.set(id, []);
    }
    for (const edge of edges) {
      if (nodeIds.has(edge.sourceServiceId) && nodeIds.has(edge.targetServiceId)) {
        adjacency.get(edge.sourceServiceId)?.push(edge.targetServiceId);
      }
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();
    const currentPath: string[] = [];
    const detectedCycles: string[][] = [];

    const dfs = (nodeId: string): void => {
      visited.add(nodeId);
      recStack.add(nodeId);
      currentPath.push(nodeId);

      const neighbors = adjacency.get(nodeId) ?? [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recStack.has(neighbor)) {
          const cycleStartIdx = currentPath.indexOf(neighbor);
          if (cycleStartIdx !== -1) {
            detectedCycles.push([...currentPath.slice(cycleStartIdx), neighbor]);
          }
        }
      }

      currentPath.pop();
      recStack.delete(nodeId);
    };

    for (const id of nodeIds) {
      if (!visited.has(id)) {
        dfs(id);
      }
    }

    if (detectedCycles.length > 0) {
      errors.push(`Se detectaron ${detectedCycles.length} ciclo(s) de dependencia en la topología.`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      cycles: detectedCycles,
    };
  }

  /**
   * Calcula la disponibilidad compuesta de un servicio considerando sus dependencias seriales y de fallback.
   * Regla SRE:
   *   - Dependencias HARD: A_total = A_source * A_target
   *   - Dependencias con FALLBACK: A_dep = 1 - (1 - A_target) * (1 - A_fallback)
   *   - Dependencias SOFT: penalización mínima (99.99%) ante degradación
   */
  public static calculateCompositeAvailability(
    rootServiceId: string,
    nodes: readonly ServiceNode[],
    edges: readonly DependencyEdge[],
    visited = new Set<string>()
  ): number {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const root = nodeMap.get(rootServiceId);
    if (!root) return 0;

    if (visited.has(rootServiceId)) {
      return root.baseAvailabilityPercentage; // Rompe ciclos recursivos si existen
    }

    visited.add(rootServiceId);
    let compositeAvailability = root.baseAvailabilityPercentage / 100;

    const outgoingEdges = edges.filter((e) => e.sourceServiceId === rootServiceId);
    for (const edge of outgoingEdges) {
      const targetNode = nodeMap.get(edge.targetServiceId);
      if (!targetNode) continue;

      const targetAvailability = (targetNode.baseAvailabilityPercentage / 100);

      if (edge.type === 'HARD') {
        const downstreamComp = this.calculateCompositeAvailability(
          edge.targetServiceId,
          nodes,
          edges,
          new Set(visited)
        ) / 100;
        compositeAvailability *= downstreamComp;
      } else if (edge.type === 'FALLBACK' && edge.fallbackServiceId) {
        const fallbackNode = nodeMap.get(edge.fallbackServiceId);
        const fallbackAvail = fallbackNode ? fallbackNode.baseAvailabilityPercentage / 100 : 0.99;
        const redundantAvail = 1 - (1 - targetAvailability) * (1 - fallbackAvail);
        compositeAvailability *= redundantAvail;
      } else if (edge.type === 'SOFT') {
        // En dependencias blandas, una caída parcial solo degrada levemente
        const softFactor = 0.9995;
        compositeAvailability *= softFactor;
      }
    }

    return Number((compositeAvailability * 100).toFixed(4));
  }

  /**
   * Identifica Puntos Únicos de Falla (SPOF) en la arquitectura.
   */
  public static findSinglePointsOfFailure(
    nodes: readonly ServiceNode[],
    edges: readonly DependencyEdge[]
  ): SinglePointOfFailureInfo[] {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const spofs: SinglePointOfFailureInfo[] = [];

    for (const node of nodes) {
      const incomingHardEdges = edges.filter(
        (e) => e.targetServiceId === node.id && e.type === 'HARD' && !e.fallbackServiceId
      );

      const dependentSources = new Set(incomingHardEdges.map((e) => e.sourceServiceId));
      const hasTier0Dependent = Array.from(dependentSources).some(
        (srcId) => nodeMap.get(srcId)?.tier === 'TIER_0'
      );

      if (hasTier0Dependent || dependentSources.size >= 2) {
        spofs.push({
          serviceId: node.id,
          serviceName: node.name,
          tier: node.tier,
          downstreamAffectedCount: dependentSources.size,
          reason: hasTier0Dependent
            ? `Servicio TIER_0 depende estrictamente de "${node.name}" sin mecanismo de fallback.`
            : `Múltiples servicios (${dependentSources.size}) dependen estrictamente de "${node.name}" sin contingencia.`,
        });
      }
    }

    return spofs;
  }

  /**
   * Modela el radio de explosión (Blast Radius) cuando un servicio objetivo falla.
   */
  public static calculateBlastRadius(
    failedServiceId: string,
    nodes: readonly ServiceNode[],
    edges: readonly DependencyEdge[]
  ): CascadingImpactSummary {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const failedNode = nodeMap.get(failedServiceId);
    const failedName = failedNode ? failedNode.name : failedServiceId;

    // Mapa de dependientes: targetServiceId -> lista de aristas donde otros dependen de él
    const dependentEdgesMap = new Map<string, DependencyEdge[]>();
    for (const edge of edges) {
      if (!dependentEdgesMap.has(edge.targetServiceId)) {
        dependentEdgesMap.set(edge.targetServiceId, []);
      }
      dependentEdgesMap.get(edge.targetServiceId)?.push(edge);
    }

    const unreachable = new Set<string>();
    const degraded = new Set<string>();
    const directDownstream = new Set<string>();

    const queue: string[] = [failedServiceId];
    const visited = new Set<string>([failedServiceId]);

    while (queue.length > 0) {
      const currentFailed = queue.shift()!;
      const dependents = dependentEdgesMap.get(currentFailed) ?? [];

      for (const edge of dependents) {
        const dependentServiceId = edge.sourceServiceId;
        if (currentFailed === failedServiceId) {
          directDownstream.add(dependentServiceId);
        }

        const hasHealthyFallback = Boolean(
          edge.fallbackServiceId &&
            edge.fallbackServiceId !== failedServiceId &&
            !unreachable.has(edge.fallbackServiceId) &&
            nodeMap.get(edge.fallbackServiceId)?.isHealthy !== false
        );

        if (edge.type === 'HARD' && !hasHealthyFallback) {
          if (!unreachable.has(dependentServiceId)) {
            unreachable.add(dependentServiceId);
            degraded.delete(dependentServiceId);
            if (!visited.has(dependentServiceId)) {
              visited.add(dependentServiceId);
              queue.push(dependentServiceId);
            }
          }
        } else {
          // Soft o con fallback activo
          if (!unreachable.has(dependentServiceId)) {
            degraded.add(dependentServiceId);
          }
        }
      }
    }

    // Calcular affected tiers
    const affectedTiersSet = new Set<DependencyCriticality>();
    for (const id of unreachable) {
      const n = nodeMap.get(id);
      if (n) affectedTiersSet.add(n.tier);
    }
    for (const id of degraded) {
      const n = nodeMap.get(id);
      if (n) affectedTiersSet.add(n.tier);
    }

    // Ponderación de Score de Blast Radius (0 a 100)
    let rawScore = 0;
    for (const id of unreachable) {
      const n = nodeMap.get(id);
      if (n?.tier === 'TIER_0') rawScore += 45;
      else if (n?.tier === 'TIER_1') rawScore += 25;
      else rawScore += 10;
    }
    for (const id of degraded) {
      const n = nodeMap.get(id);
      if (n?.tier === 'TIER_0') rawScore += 20;
      else if (n?.tier === 'TIER_1') rawScore += 10;
      else rawScore += 5;
    }

    const blastRadiusScore = Math.min(100, Math.round(rawScore));
    const isSpof = Boolean(failedNode && (failedNode.tier === 'TIER_0' || unreachable.size >= 2));

    // Generar recomendaciones de mitigación SRE
    const recommendations: string[] = [];
    if (unreachable.size > 0) {
      recommendations.push(
        `Configurar Circuit Breakers con fallbacks locales en servicios impactados (${unreachable.size}) para degradación elegante.`
      );
    }
    if (isSpof) {
      recommendations.push(
        `Eliminar Single Point of Failure en "${failedName}" mediante réplicas multi-región o pool activo-activo.`
      );
    }
    if (degraded.size > 0) {
      recommendations.push(
        `Revisar presupuestos de timeout en aristas dependientes de "${failedName}" para evitar saturación de hilos (thread pool exhaustion).`
      );
    }
    if (recommendations.length === 0) {
      recommendations.push('Impacto cascada contenido; no se detectan fallas propagadas hacia servicios Tier 0/1.');
    }

    return {
      failedServiceId,
      failedServiceName: failedName,
      blastRadiusScore,
      directDownstreamCount: directDownstream.size,
      transitiveDownstreamCount: unreachable.size + degraded.size,
      affectedTiers: Array.from(affectedTiersSet),
      unreachableServiceIds: Array.from(unreachable),
      degradedServiceIds: Array.from(degraded),
      singlePointOfFailureRisk: isSpof,
      mitigationRecommendations: recommendations,
    };
  }
}
