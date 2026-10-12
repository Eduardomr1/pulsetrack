export type IncidentStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED';
export type IncidentSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface IncidentProps {
  id: string;
  endpointId: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  startedAt: Date;
  resolvedAt?: Date | null;
  summary: string;
  consecutiveFailures: number;
}

export class Incident {
  public readonly id: string;
  public readonly endpointId: string;
  public status: IncidentStatus;
  public severity: IncidentSeverity;
  public readonly startedAt: Date;
  public resolvedAt: Date | null;
  public summary: string;
  public consecutiveFailures: number;

  constructor(props: IncidentProps) {
    this.id = props.id;
    this.endpointId = props.endpointId;
    this.status = props.status;
    this.severity = props.severity;
    this.startedAt = props.startedAt;
    this.resolvedAt = props.resolvedAt ?? null;
    this.summary = props.summary;
    this.consecutiveFailures = props.consecutiveFailures;
  }

  public resolve(resolvedAt: Date = new Date()): void {
    this.status = 'RESOLVED';
    this.resolvedAt = resolvedAt;
  }

  public incrementFailures(): void {
    this.consecutiveFailures += 1;
  }

  public isOpen(): boolean {
    return this.status === 'OPEN' || this.status === 'INVESTIGATING';
  }
}
