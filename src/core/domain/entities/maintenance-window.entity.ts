export type MaintenanceWindowStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export interface TimeIntervalRange {
  readonly startMs: number;
  readonly endMs: number;
}

export interface MaintenanceWindowProps {
  id: string;
  title: string;
  description?: string | null;
  startTime: Date;
  endTime: Date;
  affectedEndpoints?: readonly string[];
  status?: MaintenanceWindowStatus;
  createdAt?: Date;
}

/**
 * Entidad de Dominio que modela una ventana de mantenimiento programado.
 * Permite excluir periodos pactados de cambio de infraestructura del cómputo
 * de indisponibilidad no planificada (SLA / Error Budget).
 */
export class MaintenanceWindow {
  public readonly id: string;
  public title: string;
  public description: string | null;
  public readonly startTime: Date;
  public readonly endTime: Date;
  public readonly affectedEndpoints: readonly string[];
  public status: MaintenanceWindowStatus;
  public readonly createdAt: Date;

  constructor(props: MaintenanceWindowProps) {
    if (!props.id || props.id.trim().length === 0) {
      throw new Error('El identificador de la ventana de mantenimiento es obligatorio');
    }
    if (!props.title || props.title.trim().length === 0) {
      throw new Error('El título de la ventana de mantenimiento no puede estar vacío');
    }

    const startMs = props.startTime.getTime();
    const endMs = props.endTime.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new Error('Las fechas de la ventana de mantenimiento deben ser válidas');
    }
    if (endMs <= startMs) {
      throw new Error(
        'La fecha de fin de la ventana de mantenimiento debe ser estrictamente posterior al inicio'
      );
    }

    const normalizedTargets = (props.affectedEndpoints ?? ['*'])
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    if (normalizedTargets.length === 0) {
      throw new Error(
        'La ventana de mantenimiento debe especificar al menos un endpoint afectado o el comodín "*"'
      );
    }

    this.id = props.id.trim();
    this.title = props.title.trim();
    this.description = props.description?.trim() ? props.description.trim() : null;
    this.startTime = new Date(startMs);
    this.endTime = new Date(endMs);
    this.affectedEndpoints = Object.freeze(Array.from(new Set(normalizedTargets)));
    this.status = props.status ?? 'SCHEDULED';
    this.createdAt = props.createdAt ? new Date(props.createdAt.getTime()) : new Date(startMs);
  }

  public isEffective(): boolean {
    return this.status !== 'CANCELLED';
  }

  public cancel(): void {
    this.status = 'CANCELLED';
  }

  public complete(): void {
    this.status = 'COMPLETED';
  }

  public appliesToEndpoint(endpointId: string): boolean {
    if (!this.isEffective()) {
      return false;
    }
    return (
      this.affectedEndpoints.includes('*') ||
      this.affectedEndpoints.includes(endpointId.trim())
    );
  }

  public getDurationMinutes(): number {
    return Number(((this.endTime.getTime() - this.startTime.getTime()) / 60_000).toFixed(2));
  }

  public getDynamicStatus(referenceTime: Date = new Date()): MaintenanceWindowStatus {
    if (this.status === 'CANCELLED' || this.status === 'COMPLETED') {
      return this.status;
    }

    const refMs = referenceTime.getTime();
    const startMs = this.startTime.getTime();
    const endMs = this.endTime.getTime();

    if (refMs < startMs) {
      return 'SCHEDULED';
    }
    if (refMs <= endMs) {
      return 'IN_PROGRESS';
    }
    return 'COMPLETED';
  }

  public containsTimestamp(timestamp: Date, endpointId?: string): boolean {
    if (!this.isEffective()) {
      return false;
    }
    if (endpointId !== undefined && !this.appliesToEndpoint(endpointId)) {
      return false;
    }

    const ts = timestamp.getTime();
    return ts >= this.startTime.getTime() && ts <= this.endTime.getTime();
  }

  /**
   * Calcula la intersección exacta en milisegundos entre esta ventana de mantenimiento
   * y un intervalo arbitrario [rangeStart, rangeEnd].
   */
  public computeOverlapMs(rangeStart: Date, rangeEnd: Date, endpointId?: string): number {
    if (!this.isEffective()) {
      return 0;
    }
    if (endpointId !== undefined && !this.appliesToEndpoint(endpointId)) {
      return 0;
    }

    const rStart = rangeStart.getTime();
    const rEnd = rangeEnd.getTime();
    if (!Number.isFinite(rStart) || !Number.isFinite(rEnd) || rEnd <= rStart) {
      return 0;
    }

    const overlapStart = Math.max(this.startTime.getTime(), rStart);
    const overlapEnd = Math.min(this.endTime.getTime(), rEnd);
    return Math.max(0, overlapEnd - overlapStart);
  }

  /**
   * Une intervalos de mantenimiento solapados o contiguos en O(N log N) para evitar
   * doble sustracción cuando múltiples cambios programados coinciden en el tiempo.
   */
  public static mergeEffectiveIntervals(
    windows: readonly MaintenanceWindow[],
    rangeStart: Date,
    rangeEnd: Date,
    endpointId?: string
  ): TimeIntervalRange[] {
    const rStart = rangeStart.getTime();
    const rEnd = rangeEnd.getTime();
    if (!Number.isFinite(rStart) || !Number.isFinite(rEnd) || rEnd <= rStart) {
      return [];
    }

    const clipped: TimeIntervalRange[] = [];
    for (const win of windows) {
      if (!win.isEffective()) {
        continue;
      }
      if (endpointId !== undefined && !win.appliesToEndpoint(endpointId)) {
        continue;
      }

      const startMs = Math.max(win.startTime.getTime(), rStart);
      const endMs = Math.min(win.endTime.getTime(), rEnd);
      if (endMs > startMs) {
        clipped.push({ startMs, endMs });
      }
    }

    if (clipped.length === 0) {
      return [];
    }

    clipped.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

    const first = clipped[0];
    if (!first) {
      return [];
    }

    const merged: { startMs: number; endMs: number }[] = [
      { startMs: first.startMs, endMs: first.endMs },
    ];

    for (let i = 1; i < clipped.length; i += 1) {
      const current = clipped[i];
      const last = merged[merged.length - 1];
      if (!current || !last) {
        continue;
      }

      if (current.startMs <= last.endMs) {
        last.endMs = Math.max(last.endMs, current.endMs);
      } else {
        merged.push({ startMs: current.startMs, endMs: current.endMs });
      }
    }

    return merged;
  }

  /**
   * Calcula los milisegundos totales únicos cubiertos por mantenimiento dentro de [rangeStart, rangeEnd].
   */
  public static computeMergedOverlapMs(
    windows: readonly MaintenanceWindow[],
    rangeStart: Date,
    rangeEnd: Date,
    endpointId?: string
  ): number {
    const merged = MaintenanceWindow.mergeEffectiveIntervals(
      windows,
      rangeStart,
      rangeEnd,
      endpointId
    );
    return merged.reduce((acc, interval) => acc + (interval.endMs - interval.startMs), 0);
  }
}
