export type DependencyCriticality = 'TIER_0' | 'TIER_1' | 'TIER_2';
export type DependencyType = 'HARD' | 'SOFT' | 'FALLBACK';

export interface ServiceNode {
  readonly id: string;
  readonly name: string;
  readonly tier: DependencyCriticality;
  readonly baseAvailabilityPercentage: number; // e.g. 99.95
  readonly isHealthy: boolean;
  readonly tags?: readonly string[];
}

export interface DependencyEdge {
  readonly sourceServiceId: string;
  readonly targetServiceId: string;
  readonly type: DependencyType;
  readonly timeoutMs?: number;
  readonly fallbackServiceId?: string;
}

export interface CascadingImpactSummary {
  readonly failedServiceId: string;
  readonly failedServiceName: string;
  readonly blastRadiusScore: number; // 0 - 100
  readonly directDownstreamCount: number;
  readonly transitiveDownstreamCount: number;
  readonly affectedTiers: readonly DependencyCriticality[];
  readonly unreachableServiceIds: readonly string[];
  readonly degradedServiceIds: readonly string[];
  readonly singlePointOfFailureRisk: boolean;
  readonly mitigationRecommendations: readonly string[];
}
