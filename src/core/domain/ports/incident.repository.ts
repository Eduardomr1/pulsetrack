import { Incident } from '../entities/incident.entity';

export interface IIncidentRepository {
  findById(id: string): Promise<Incident | null>;
  findAll(limit?: number): Promise<Incident[]>;
  findActiveByEndpointId(endpointId: string): Promise<Incident | null>;
  findByEndpointId(endpointId: string, limit?: number): Promise<Incident[]>;
  findRecent(limit?: number): Promise<Incident[]>;
  countActive(): Promise<number>;
  save(incident: Incident): Promise<void>;
  update(incident: Incident): Promise<void>;
}
