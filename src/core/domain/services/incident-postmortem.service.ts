import { Incident } from '../entities/incident.entity';
import { Endpoint } from '../entities/endpoint.entity';

export interface SlaCreditTier {
  thresholdPercentage: number;
  creditPercentage: number;
}

export interface PostmortemMetrics {
  durationMinutes: number;
  timeToDetectMinutes: number;
  timeToAcknowledgeMinutes: number;
  timeToResolveMinutes: number;
  availabilityImpactPercentage: number;
  errorBudgetConsumedPercentage: number;
  slaBreach: boolean;
  eligibleCreditPercentage: number;
}

export interface StructuredPostmortem {
  incidentId: string;
  endpointId: string;
  endpointName: string;
  severity: string;
  summary: string;
  rootCause: string;
  startedAt: string;
  resolvedAt: string;
  metrics: PostmortemMetrics;
  timeline: Array<{ timestamp: string; message: string; type: string }>;
  markdown: string;
}

export class IncidentPostmortemService {
  private static readonly DEFAULT_SLA_TIERS: SlaCreditTier[] = [
    { thresholdPercentage: 99.0, creditPercentage: 10 },
    { thresholdPercentage: 95.0, creditPercentage: 25 },
    { thresholdPercentage: 90.0, creditPercentage: 50 },
  ];

  public static generate(
    incident: Incident,
    endpoint: Endpoint,
    options?: {
      targetSlaPercentage?: number;
      windowTotalMinutes?: number;
      customTiers?: SlaCreditTier[];
    }
  ): StructuredPostmortem {
    const targetSla = options?.targetSlaPercentage ?? 99.9;
    const windowMinutes = options?.windowTotalMinutes ?? 43200; // 30 días
    const tiers = options?.customTiers ?? this.DEFAULT_SLA_TIERS;

    const startedTime = incident.startedAt.getTime();
    const resolvedTime = incident.resolvedAt ? incident.resolvedAt.getTime() : Date.now();
    const durationMs = Math.max(0, resolvedTime - startedTime);
    const durationMinutes = Number((durationMs / 60000).toFixed(2));

    const ackTime = incident.acknowledgedAt ? incident.acknowledgedAt.getTime() : resolvedTime;
    const ttdMinutes = Number((Math.max(0, ackTime - startedTime) / 60000).toFixed(2));
    const ttaMinutes = incident.acknowledgedAt
      ? Number((Math.max(0, ackTime - startedTime) / 60000).toFixed(2))
      : ttdMinutes;
    const ttrMinutes = Number((durationMs / 60000).toFixed(2));

    const totalAllowedDowntimeMinutes = windowMinutes * (1 - targetSla / 100);
    const availabilityImpact = Number(((durationMinutes / windowMinutes) * 100).toFixed(4));
    const windowAvailability = Number(Math.max(0, 100 - availabilityImpact).toFixed(4));
    const errorBudgetConsumed = totalAllowedDowntimeMinutes > 0
      ? Number(((durationMinutes / totalAllowedDowntimeMinutes) * 100).toFixed(2))
      : 100;

    let eligibleCredit = 0;
    for (const tier of tiers) {
      if (windowAvailability < tier.thresholdPercentage) {
        eligibleCredit = Math.max(eligibleCredit, tier.creditPercentage);
      }
    }

    const metrics: PostmortemMetrics = {
      durationMinutes,
      timeToDetectMinutes: ttdMinutes,
      timeToAcknowledgeMinutes: ttaMinutes,
      timeToResolveMinutes: ttrMinutes,
      availabilityImpactPercentage: availabilityImpact,
      errorBudgetConsumedPercentage: errorBudgetConsumed,
      slaBreach: errorBudgetConsumed >= 100,
      eligibleCreditPercentage: eligibleCredit,
    };

    const rootCauseText = incident.rootCause || 'Under investigation / root-cause analysis in progress';
    const timelineFormatted = (incident.timeline || []).map((t) => ({
      timestamp: t.timestamp,
      message: t.message,
      type: t.type,
    }));

    const markdown = this.renderMarkdown(incident, endpoint, metrics, rootCauseText);

    return {
      incidentId: incident.id,
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      severity: incident.severity,
      summary: incident.summary,
      rootCause: rootCauseText,
      startedAt: incident.startedAt.toISOString(),
      resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : 'ONGOING',
      metrics,
      timeline: timelineFormatted,
      markdown,
    };
  }

  private static renderMarkdown(
    incident: Incident,
    endpoint: Endpoint,
    metrics: PostmortemMetrics,
    rootCause: string
  ): string {
    return `# SRE Incident Postmortem: ${incident.summary}

## Executive Summary
- **Endpoint:** ${endpoint.name} (\`${endpoint.url.value}\`)
- **Severity:** \`${incident.severity}\`
- **Total Duration:** ${metrics.durationMinutes} min
- **Error Budget Consumed:** ${metrics.errorBudgetConsumedPercentage}%
- **SLA Breach:** ${metrics.slaBreach ? '⚠️ YES' : '✅ NO'}
- **Service Credit:** ${metrics.eligibleCreditPercentage}%

## Impact & Key Reliability Metrics
- **Time to Detect (MTTD):** ${metrics.timeToDetectMinutes} min
- **Time to Resolve (MTTR):** ${metrics.timeToResolveMinutes} min
- **Availability Degradation:** -${metrics.availabilityImpactPercentage}%

## Root Cause
${rootCause}

## Remediation & Action Items
- [ ] Add canary health check probe with tighter timeout.
- [ ] Implement automatic fallback route for 5xx errors.
- [ ] Adjust alert deduplication cooldown window.
`;
  }
}
