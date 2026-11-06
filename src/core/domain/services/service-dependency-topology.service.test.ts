import { describe, expect, it } from 'vitest';
import { DependencyEdge, ServiceNode } from '../entities/service-dependency.entity';
import { ServiceDependencyTopologyService } from './service-dependency-topology.service';

describe('ServiceDependencyTopologyService', () => {
  const sampleNodes: ServiceNode[] = [
    { id: 'gateway', name: 'API Gateway', tier: 'TIER_0', baseAvailabilityPercentage: 99.99, isHealthy: true },
    { id: 'auth', name: 'Auth Service', tier: 'TIER_0', baseAvailabilityPercentage: 99.95, isHealthy: true },
    { id: 'billing', name: 'Billing Service', tier: 'TIER_1', baseAvailabilityPercentage: 99.9, isHealthy: true },
    { id: 'notifications', name: 'Notification Worker', tier: 'TIER_2', baseAvailabilityPercentage: 99.5, isHealthy: true },
    { id: 'db-primary', name: 'Primary DB', tier: 'TIER_0', baseAvailabilityPercentage: 99.99, isHealthy: true },
    { id: 'db-replica', name: 'Replica DB', tier: 'TIER_1', baseAvailabilityPercentage: 99.9, isHealthy: true },
  ];

  describe('validateTopology', () => {
    it('valida una topología dirigida acíclica correctamente', () => {
      const edges: DependencyEdge[] = [
        { sourceServiceId: 'gateway', targetServiceId: 'auth', type: 'HARD' },
        { sourceServiceId: 'gateway', targetServiceId: 'billing', type: 'HARD' },
        { sourceServiceId: 'billing', targetServiceId: 'notifications', type: 'SOFT' },
        { sourceServiceId: 'auth', targetServiceId: 'db-primary', type: 'HARD', fallbackServiceId: 'db-replica' },
      ];

      const result = ServiceDependencyTopologyService.validateTopology(sampleNodes, edges);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.cycles).toEqual([]);
    });

    it('detecta referencias a nodos inexistentes o identificadores duplicados', () => {
      const brokenNodes = [...sampleNodes, { ...sampleNodes[0]! }];
      const edges: DependencyEdge[] = [
        { sourceServiceId: 'gateway', targetServiceId: 'unknown-service', type: 'HARD' },
      ];

      const result = ServiceDependencyTopologyService.validateTopology(brokenNodes, edges);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('duplicado'))).toBe(true);
      expect(result.errors.some((e) => e.includes('unknown-service'))).toBe(true);
    });

    it('detecta ciclos directos e indirectos en la topología', () => {
      const cyclicEdges: DependencyEdge[] = [
        { sourceServiceId: 'auth', targetServiceId: 'billing', type: 'HARD' },
        { sourceServiceId: 'billing', targetServiceId: 'notifications', type: 'HARD' },
        { sourceServiceId: 'notifications', targetServiceId: 'auth', type: 'HARD' },
      ];

      const result = ServiceDependencyTopologyService.validateTopology(sampleNodes, cyclicEdges);
      expect(result.isValid).toBe(false);
      expect(result.cycles.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('ciclo'))).toBe(true);
    });
  });

  describe('calculateCompositeAvailability', () => {
    it('calcula la disponibilidad base en nodos hoja sin dependencias', () => {
      const avail = ServiceDependencyTopologyService.calculateCompositeAvailability('db-primary', sampleNodes, []);
      expect(avail).toBe(99.99);
    });

    it('compone la degradación de disponibilidad en dependencias seriales HARD', () => {
      const edges: DependencyEdge[] = [
        { sourceServiceId: 'gateway', targetServiceId: 'auth', type: 'HARD' },
        { sourceServiceId: 'auth', targetServiceId: 'db-primary', type: 'HARD' },
      ];

      const avail = ServiceDependencyTopologyService.calculateCompositeAvailability('gateway', sampleNodes, edges);
      // 0.9999 * 0.9995 * 0.9999 = 0.9993
      expect(avail).toBeLessThan(99.99);
      expect(avail).toBeGreaterThan(99.9);
    });

    it('eleva la disponibilidad cuando existe un fallback redundante', () => {
      const edgesWithFallback: DependencyEdge[] = [
        { sourceServiceId: 'auth', targetServiceId: 'billing', type: 'FALLBACK', fallbackServiceId: 'notifications' },
      ];

      const avail = ServiceDependencyTopologyService.calculateCompositeAvailability(
        'auth',
        sampleNodes,
        edgesWithFallback
      );
      expect(avail).toBeGreaterThan(99.94);
    });
  });

  describe('findSinglePointsOfFailure', () => {
    it('identifica dependencias críticas sin contingencia como SPOF', () => {
      const edges: DependencyEdge[] = [
        { sourceServiceId: 'gateway', targetServiceId: 'auth', type: 'HARD' },
        { sourceServiceId: 'billing', targetServiceId: 'auth', type: 'HARD' },
      ];

      const spofs = ServiceDependencyTopologyService.findSinglePointsOfFailure(sampleNodes, edges);
      expect(spofs.length).toBeGreaterThan(0);
      expect(spofs.some((s) => s.serviceId === 'auth')).toBe(true);
    });

    it('no marca un servicio con fallback activo como SPOF exclusivo', () => {
      const edges: DependencyEdge[] = [
        { sourceServiceId: 'gateway', targetServiceId: 'auth', type: 'HARD', fallbackServiceId: 'db-replica' },
      ];

      const spofs = ServiceDependencyTopologyService.findSinglePointsOfFailure(sampleNodes, edges);
      expect(spofs.every((s) => s.serviceId !== 'auth')).toBe(true);
    });
  });

  describe('calculateBlastRadius', () => {
    it('calcula el radio de explosión y servicios inalcanzables ante caída de nodo crítico', () => {
      const edges: DependencyEdge[] = [
        { sourceServiceId: 'gateway', targetServiceId: 'auth', type: 'HARD' },
        { sourceServiceId: 'billing', targetServiceId: 'auth', type: 'HARD' },
        { sourceServiceId: 'notifications', targetServiceId: 'billing', type: 'HARD' },
      ];

      const impact = ServiceDependencyTopologyService.calculateBlastRadius('auth', sampleNodes, edges);
      expect(impact.failedServiceId).toBe('auth');
      expect(impact.directDownstreamCount).toBe(2); // gateway y billing
      expect(impact.transitiveDownstreamCount).toBe(3); // gateway, billing, notifications
      expect(impact.unreachableServiceIds).toContain('gateway');
      expect(impact.unreachableServiceIds).toContain('billing');
      expect(impact.unreachableServiceIds).toContain('notifications');
      expect(impact.blastRadiusScore).toBeGreaterThanOrEqual(70);
      expect(impact.singlePointOfFailureRisk).toBe(true);
      expect(impact.mitigationRecommendations.length).toBeGreaterThan(0);
    });

    it('clasifica servicios dependientes como degradados cuando poseen fallback saludable', () => {
      const edges: DependencyEdge[] = [
        { sourceServiceId: 'gateway', targetServiceId: 'auth', type: 'HARD', fallbackServiceId: 'db-replica' },
      ];

      const impact = ServiceDependencyTopologyService.calculateBlastRadius('auth', sampleNodes, edges);
      expect(impact.unreachableServiceIds).toHaveLength(0);
      expect(impact.degradedServiceIds).toContain('gateway');
      expect(impact.blastRadiusScore).toBeLessThan(50);
    });
  });
});
