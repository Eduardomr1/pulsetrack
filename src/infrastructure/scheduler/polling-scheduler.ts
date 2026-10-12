import { IEndpointRepository } from '../../core/domain/ports/endpoint.repository';
import { ExecuteProbeUseCase } from '../../core/application/use-cases/execute-probe.use-case';

export class PollingScheduler {
  private isRunning: boolean = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private readonly lastCheckedMap: Map<string, number> = new Map();
  private isProcessingTick: boolean = false;

  constructor(
    private readonly endpointRepo: IEndpointRepository,
    private readonly executeProbeUseCase: ExecuteProbeUseCase,
    private readonly maxConcurrency: number = 10,
    private readonly tickIntervalMs: number = 3000 // Ticks every 3s to inspect schedule
  ) {}

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[PulseTrack Poller] Motor de sondeo iniciado.');

    this.intervalTimer = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);

    // Initial immediate tick
    void this.tick();
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    console.log('[PulseTrack Poller] Motor de sondeo detenido.');
  }

  private async tick(): Promise<void> {
    if (this.isProcessingTick || !this.isRunning) return;
    this.isProcessingTick = true;

    try {
      const activeEndpoints = await this.endpointRepo.findAllActive();
      const now = Date.now();

      // Filter endpoints that are due for a probe
      const dueEndpoints = activeEndpoints.filter((ep) => {
        const lastChecked = this.lastCheckedMap.get(ep.id) ?? 0;
        // Apply +/- 5% jitter to prevent thundering herd
        const jitter = (Math.random() - 0.5) * 0.1 * (ep.intervalSeconds * 1000);
        const threshold = ep.intervalSeconds * 1000 + jitter;
        return now - lastChecked >= threshold;
      });

      if (dueEndpoints.length === 0) return;

      // Execute in batches up to maxConcurrency
      for (let i = 0; i < dueEndpoints.length; i += this.maxConcurrency) {
        const batch = dueEndpoints.slice(i, i + this.maxConcurrency);
        await Promise.allSettled(
          batch.map(async (endpoint) => {
            this.lastCheckedMap.set(endpoint.id, Date.now());
            try {
              await this.executeProbeUseCase.execute({ endpoint });
            } catch (err) {
              console.error(`[PulseTrack Poller] Error sondando ${endpoint.name} (${endpoint.url.value}):`, err);
            }
          })
        );
      }
    } catch (err) {
      console.error('[PulseTrack Poller] Error en ciclo de sondeo tick:', err);
    } finally {
      this.isProcessingTick = false;
    }
  }

  public async triggerImmediate(endpointId: string): Promise<void> {
    const endpoint = await this.endpointRepo.findById(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} no encontrado`);
    this.lastCheckedMap.set(endpoint.id, Date.now());
    await this.executeProbeUseCase.execute({ endpoint });
  }
}
