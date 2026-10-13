export type IncidentStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED';
export type IncidentSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface IncidentTimelineEvent {
  id: string;
  timestamp: string;
  message: string;
  author?: string;
  type: 'DETECTED' | 'ACKNOWLEDGED' | 'UPDATE' | 'RESOLVED';
}

export interface IncidentProps {
  id: string;
  endpointId: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  startedAt: Date;
  acknowledgedAt?: Date | null;
  resolvedAt?: Date | null;
  summary: string;
  rootCause?: string | null;
  consecutiveFailures: number;
  timeline?: IncidentTimelineEvent[];
}

export class Incident {
  public readonly id: string;
  public readonly endpointId: string;
  public status: IncidentStatus;
  public severity: IncidentSeverity;
  public readonly startedAt: Date;
  public acknowledgedAt: Date | null;
  public resolvedAt: Date | null;
  public summary: string;
  public rootCause: string | null;
  public consecutiveFailures: number;
  public timeline: IncidentTimelineEvent[];

  constructor(props: IncidentProps) {
    this.id = props.id;
    this.endpointId = props.endpointId;
    this.status = props.status;
    this.severity = props.severity;
    this.startedAt = props.startedAt;
    this.acknowledgedAt = props.acknowledgedAt ?? null;
    this.resolvedAt = props.resolvedAt ?? null;
    this.summary = props.summary;
    this.rootCause = props.rootCause ?? null;
    this.consecutiveFailures = props.consecutiveFailures;
    this.timeline = props.timeline ?? [
      {
        id: `tl_${Date.now()}_det`,
        timestamp: props.startedAt.toISOString(),
        message: `Incidente detectado automáticamente: ${props.summary}`,
        type: 'DETECTED',
        author: 'PulseTrack Prober Engine',
      },
    ];
  }

  public acknowledge(at: Date = new Date(), note?: string, author: string = 'On-Call Engineer'): void {
    this.status = 'INVESTIGATING';
    this.acknowledgedAt = at;
    this.timeline.push({
      id: `tl_${Date.now()}_ack`,
      timestamp: at.toISOString(),
      message: note ?? 'Incidente reconocido. Investigación en curso.',
      author,
      type: 'ACKNOWLEDGED',
    });
  }

  public addTimelineNote(message: string, author: string = 'SRE Team'): void {
    this.timeline.push({
      id: `tl_${Date.now()}_upd`,
      timestamp: new Date().toISOString(),
      message,
      author,
      type: 'UPDATE',
    });
  }

  public resolve(resolvedAt: Date = new Date(), rootCause?: string, author: string = 'On-Call Engineer'): void {
    this.status = 'RESOLVED';
    this.resolvedAt = resolvedAt;
    if (rootCause) {
      this.rootCause = rootCause;
    }
    this.timeline.push({
      id: `tl_${Date.now()}_res`,
      timestamp: resolvedAt.toISOString(),
      message: `Incidente resuelto.${rootCause ? ` Causa raíz: ${rootCause}` : ''}`,
      author,
      type: 'RESOLVED',
    });
  }

  public incrementFailures(): void {
    this.consecutiveFailures += 1;
  }

  public isOpen(): boolean {
    return this.status === 'OPEN' || this.status === 'INVESTIGATING';
  }

  public getDurationMinutes(): number {
    const end = this.resolvedAt ?? new Date();
    return Number(((end.getTime() - this.startedAt.getTime()) / (1000 * 60)).toFixed(1));
  }

  public getTimeToAcknowledgeMinutes(): number | null {
    if (!this.acknowledgedAt) return null;
    return Number(((this.acknowledgedAt.getTime() - this.startedAt.getTime()) / (1000 * 60)).toFixed(1));
  }

  public addTimelineEvent(event: IncidentTimelineEvent): void {
    this.timeline.push(event);
  }

  public toJSON() {
    return {
      id: this.id,
      endpointId: this.endpointId,
      status: this.status,
      severity: this.severity,
      startedAt: this.startedAt.toISOString(),
      acknowledgedAt: this.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: this.resolvedAt?.toISOString() ?? null,
      durationMinutes: this.getDurationMinutes(),
      timeToAcknowledgeMinutes: this.getTimeToAcknowledgeMinutes(),
      summary: this.summary,
      rootCause: this.rootCause,
      consecutiveFailures: this.consecutiveFailures,
      timeline: this.timeline,
    };
  }
}
