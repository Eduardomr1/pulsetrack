export type HealthStatusType = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';

export class HealthStatusVo {
  public static readonly HEALTHY = new HealthStatusVo('HEALTHY');
  public static readonly DEGRADED = new HealthStatusVo('DEGRADED');
  public static readonly DOWN = new HealthStatusVo('DOWN');
  public static readonly UNKNOWN = new HealthStatusVo('UNKNOWN');

  private constructor(public readonly value: HealthStatusType) {}

  public static fromString(val: string): HealthStatusVo {
    switch (val.toUpperCase()) {
      case 'HEALTHY':
      case 'UP':
        return HealthStatusVo.HEALTHY;
      case 'DEGRADED':
        return HealthStatusVo.DEGRADED;
      case 'DOWN':
        return HealthStatusVo.DOWN;
      default:
        return HealthStatusVo.UNKNOWN;
    }
  }

  public isAvailable(): boolean {
    return this.value === 'HEALTHY' || this.value === 'DEGRADED';
  }

  public isHealthy(): boolean {
    return this.value === 'HEALTHY';
  }

  public isDegraded(): boolean {
    return this.value === 'DEGRADED';
  }

  public isDown(): boolean {
    return this.value === 'DOWN';
  }
}
