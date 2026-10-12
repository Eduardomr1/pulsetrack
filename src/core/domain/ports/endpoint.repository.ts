import { Endpoint } from '../entities/endpoint.entity';

export interface IEndpointRepository {
  findById(id: string): Promise<Endpoint | null>;
  findAll(): Promise<Endpoint[]>;
  findAllActive(): Promise<Endpoint[]>;
  save(endpoint: Endpoint): Promise<void>;
  update(endpoint: Endpoint): Promise<void>;
  delete(id: string): Promise<void>;
}
