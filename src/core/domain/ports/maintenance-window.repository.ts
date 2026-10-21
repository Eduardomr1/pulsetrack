import { MaintenanceWindow } from '../entities/maintenance-window.entity';

export interface MaintenanceWindowRangeQuery {
  readonly from: Date;
  readonly to: Date;
  readonly endpointId?: string;
}

export interface IMaintenanceWindowRepository {
  findById(id: string): Promise<MaintenanceWindow | null>;
  findAll(): Promise<MaintenanceWindow[]>;
  findOverlappingRange(query: MaintenanceWindowRangeQuery): Promise<MaintenanceWindow[]>;
  findActiveAt(timestamp: Date, endpointId?: string): Promise<MaintenanceWindow[]>;
  save(window: MaintenanceWindow): Promise<void>;
  update(window: MaintenanceWindow): Promise<void>;
}
