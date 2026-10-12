import { Incident } from '../entities/incident.entity';

export interface IIncidentRepository {
  findActiveByEndpointId(endpointId: string): Promise<Incident | null>;
  findRecent(limit?: number): Promise<Incident[]>;
  countActive(): Promise<number>;
  save(incident: Incident): Promise<void>;
  update(incident: Incident): Promise<void>;
}
