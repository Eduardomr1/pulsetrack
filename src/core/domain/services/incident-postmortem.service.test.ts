import { describe, it, expect } from 'vitest';
import { Incident } from '../entities/incident.entity';
import { Endpoint } from '../entities/endpoint.entity';
import { UrlVo } from '../value-objects/url.vo';
import { HttpMethodVo } from '../value-objects/http-method.vo';
import { IncidentPostmortemService } from './incident-postmortem.service';

describe('IncidentPostmortemService', () => {
  const endpoint = new Endpoint({
    id: 'ep-test-1',
    name: 'Payments Core API',
    url: new UrlVo('https://api.example.com/pay'),
    method: new HttpMethodVo('POST'),
    intervalSeconds: 30,
    timeoutMs: 5000,
    expectedStatusCodes: [200],
    assertions: [],
    isActive: true,
    tags: ['production'],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('calculates duration, MTTD, MTTR, and detects SLA breach correctly', () => {
    const started = new Date('2026-10-20T10:00:00Z');
    const ack = new Date('2026-10-20T10:05:00Z');
    const resolved = new Date('2026-10-20T11:00:00Z'); // 60 min

    const incident = new Incident({
      id: 'inc-1',
      endpointId: endpoint.id,
      status: 'RESOLVED',
      severity: 'CRITICAL',
      startedAt: started,
      acknowledgedAt: ack,
      resolvedAt: resolved,
      summary: 'High error rate in payment webhooks',
      rootCause: 'Database connection pool starvation',
      consecutiveFailures: 5,
      timeline: [
        { id: 't1', timestamp: started.toISOString(), message: 'Triggered P1 alert', type: 'DETECTED' },
        { id: 't2', timestamp: ack.toISOString(), message: 'On-call acknowledged', type: 'ACKNOWLEDGED' },
        { id: 't3', timestamp: resolved.toISOString(), message: 'Pool resized and restarted', type: 'RESOLVED' },
      ],
    });

    const postmortem = IncidentPostmortemService.generate(incident, endpoint, {
      targetSlaPercentage: 99.9, // 43.2 min allowed in 30d
      windowTotalMinutes: 43200,
    });

    expect(postmortem.incidentId).toBe('inc-1');
    expect(postmortem.endpointName).toBe('Payments Core API');
    expect(postmortem.metrics.durationMinutes).toBe(60);
    expect(postmortem.metrics.timeToDetectMinutes).toBe(5);
    expect(postmortem.metrics.timeToResolveMinutes).toBe(60);
    expect(postmortem.metrics.slaBreach).toBe(true);
    expect(postmortem.markdown).toContain('Payments Core API');
    expect(postmortem.markdown).toContain('Database connection pool starvation');
  });

  it('evaluates eligible service credit tiers when availability drops below threshold', () => {
    const started = new Date('2026-10-20T00:00:00Z');
    const resolved = new Date('2026-10-20T12:00:00Z'); // 720 min = 12h = 50% of 1d

    const incident = new Incident({
      id: 'inc-2',
      endpointId: endpoint.id,
      status: 'RESOLVED',
      severity: 'CRITICAL',
      startedAt: started,
      resolvedAt: resolved,
      summary: 'Data center network partition',
      consecutiveFailures: 20,
    });

    const postmortem = IncidentPostmortemService.generate(incident, endpoint, {
      targetSlaPercentage: 99.0,
      windowTotalMinutes: 1440, // 1 day window
    });

    expect(postmortem.metrics.eligibleCreditPercentage).toBe(50);
  });
});
