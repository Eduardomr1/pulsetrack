import { describe, expect, it } from 'vitest';
import { DependencyEdge, ServiceNode } from '../../domain/entities/service-dependency.entity';
import { AnalyzeDependencyBlastRadiusUseCase } from './analyze-dependency-blast-radius.use-case';

describe('AnalyzeDependencyBlastRadiusUseCase', () => {
  const useCase = new AnalyzeDependencyBlastRadiusUseCase();

  const nodes: ServiceNode[] = [
    { id: 'web-app', name: 'Web Portal', tier: 'TIER_0', baseAvailabilityPercentage: 99.9, isHealthy: true },
    { id: 'auth-service', name: 'OAuth Core', tier: 'TIER_0', baseAvailabilityPercentage: 99.99, isHealthy: true },
    { id: 'redis-cache', name: 'Session Cache', tier: 'TIER_1', baseAvailabilityPercentage: 99.9, isHealthy: true },
    { id: 'payment-gateway', name: 'Stripe Adapter', tier: 'TIER_0', baseAvailabilityPercentage: 99.95, isHealthy: true },
  ];

  const edges: DependencyEdge[] = [
    { sourceServiceId: 'web-app', targetServiceId: 'auth-service', type: 'HARD' },
    { sourceServiceId: 'auth-service', targetServiceId: 'redis-cache', type: 'HARD' },
    { sourceServiceId: 'web-app', targetServiceId: 'payment-gateway', type: 'HARD' },
  ];

  it('ejecuta el análisis de blast radius completo y calcula métricas SRE de impacto', () => {
    const result = useCase.execute({
      targetServiceId: 'auth-service',
      nodes,
      edges,
    });

    expect(result.targetServiceId).toBe('auth-service');
    expect(result.targetServiceName).toBe('OAuth Core');
    expect(result.isTopologyValid).toBe(true);
    expect(result.blastRadius.unreachableServiceIds).toContain('web-app');
    expect(result.blastRadius.blastRadiusScore).toBeGreaterThanOrEqual(45);
    expect(result.preIncidentCompositeAvailabilityPercentage).toBeGreaterThan(0);
    expect(result.postIncidentCompositeAvailabilityPercentage).toBe(0);
    expect(result.executiveSummary).toContain('OAuth Core');
  });

  it('reporta advertencias de validación cuando la topología contiene anomalías', () => {
    const cyclicEdges: DependencyEdge[] = [
      { sourceServiceId: 'web-app', targetServiceId: 'auth-service', type: 'HARD' },
      { sourceServiceId: 'auth-service', targetServiceId: 'web-app', type: 'HARD' },
    ];

    const result = useCase.execute({
      targetServiceId: 'auth-service',
      nodes,
      edges: cyclicEdges,
    });

    expect(result.isTopologyValid).toBe(false);
    expect(result.detectedCycles.length).toBeGreaterThan(0);
    expect(result.topologyErrors.length).toBeGreaterThan(0);
  });
});
