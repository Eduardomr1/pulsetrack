import {
  Incident,
  IncidentSeverity,
  IncidentTimelineEvent,
} from '../entities/incident.entity';
import {
  MaintenanceWindow,
  TimeIntervalRange,
} from '../entities/maintenance-window.entity';

export type EpisodeMaintenanceCoverage =
  | 'UNPLANNED_OUTAGE'
  | 'PARTIALLY_EXCLUDED'
  | 'FULLY_COVERED_BY_MAINTENANCE';

export interface IncidentReliabilityOptions {
  readonly endpointId: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly coalesceGapMinutes?: number;
  readonly flappingThreshold?: number;
  readonly minUnplannedOutageSeconds?: number;
  readonly probeIntervalSeconds?: number;
  readonly consecutiveFailuresThreshold?: number;
}

export interface CoalescedIncidentEpisode {
  readonly episodeId: string;
  readonly endpointId: string;
  readonly subIncidentIds: readonly string[];
  readonly severity: IncidentSeverity;
  readonly isOngoing: boolean;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly acknowledgedAt: string | null;
  readonly flapCount: number;
  readonly isFlapping: boolean;
  readonly totalConsecutiveFailures: number;
  readonly wallClockDurationMinutes: number;
  readonly rawOutageMinutes: number;
  readonly interFlapRecoveryMinutes: number;
  readonly excludedMaintenanceMinutes: number;
  readonly unplannedOutageMinutes: number;
  readonly maintenanceCoverage: EpisodeMaintenanceCoverage;
  readonly isSuppressedMicroOutage: boolean;
  readonly countsTowardSlaBreach: boolean;
  readonly timeToDetectSeconds: number;
  readonly timeToAcknowledgeMinutes: number | null;
  readonly effectiveMttrMinutes: number | null;
  readonly primarySummary: string;
  readonly rootCause: string | null;
  readonly mergedTimeline: readonly IncidentTimelineEvent[];
}

export interface EndpointReliabilityReport {
  readonly endpointId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly totalWindowMinutes: number;
  readonly scheduledMaintenanceMinutes: number;
  readonly eligibleServiceMinutes: number;
  readonly rawDowntimeMinutes: number;
  readonly excludedMaintenanceDowntimeMinutes: number;
  readonly suppressedHysteresisDowntimeMinutes: number;
  readonly effectiveUnplannedDowntimeMinutes: number;
  readonly rawUptimePercentage: number;
  readonly adjustedUptimePercentage: number;
  readonly totalRawIncidents: number;
  readonly coalescedEpisodesCount: number;
  readonly unplannedEpisodesCount: number;
  readonly flappingEpisodesCount: number;
  readonly maintenanceCoveredEpisodesCount: number;
  readonly suppressedMicroOutagesCount: number;
  readonly meanTimeToDetectSeconds: number;
  readonly meanTimeToAcknowledgeMinutes: number | null;
  readonly meanTimeToResolveMinutes: number | null;
  readonly meanTimeBetweenFailuresHours: number | null;
  readonly episodes: readonly CoalescedIncidentEpisode[];
}

interface ClippedIncidentRecord {
  readonly incident: Incident;
  readonly clippedStartMs: number;
  readonly clippedEndMs: number;
  readonly isOngoingAtWindowEnd: boolean;
}

/**
 * Servicio de Dominio SRE encargado de:
 * 1. Coalescer líneas de tiempo de incidentes fragmentados (micro-cortes dentro de una brecha de histéresis).
 * 2. Detectar episodios de oscilación rápida (flapping) y consolidar severidades y bitácoras.
 * 3. Sustraer intersecciones exactas con ventanas de mantenimiento programado sin doble conteo.
 * 4. Calcular MTTD, MTTA, MTTR, MTBF y porcentaje de disponibilidad ajustado por mantenimiento.
 */
export class IncidentReliabilityService {
  private static readonly SEVERITY_RANK: Readonly<Record<IncidentSeverity, number>> = {
    INFO: 1,
    WARNING: 2,
    CRITICAL: 3,
  };

  public evaluate(
    incidents: readonly Incident[],
    maintenanceWindows: readonly MaintenanceWindow[],
    options: IncidentReliabilityOptions
  ): EndpointReliabilityReport {
    const windowStartMs = options.windowStart.getTime();
    const windowEndMs = options.windowEnd.getTime();

    if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) {
      throw new Error(
        'La ventana de análisis de confiabilidad requiere windowEnd estrictamente posterior a windowStart'
      );
    }

    const coalesceGapMs = Math.max(0, (options.coalesceGapMinutes ?? 5) * 60_000);
    const flappingThreshold = Math.max(2, Math.floor(options.flappingThreshold ?? 3));
    const minUnplannedOutageMs = Math.max(0, (options.minUnplannedOutageSeconds ?? 0) * 1_000);
    const probeIntervalSeconds = Math.max(5, options.probeIntervalSeconds ?? 30);
    const consecutiveFailuresThreshold = Math.max(1, options.consecutiveFailuresThreshold ?? 3);
    const estimatedDetectionSeconds = Number(
      (probeIntervalSeconds * consecutiveFailuresThreshold).toFixed(2)
    );

    const clippedRecords = this.clipAndSortIncidents(
      incidents,
      options.endpointId,
      windowStartMs,
      windowEndMs
    );

    const groupedClusters = this.clusterByHysteresisGap(clippedRecords, coalesceGapMs);

    const episodes: CoalescedIncidentEpisode[] = groupedClusters.map((cluster, idx) =>
      this.buildEpisode({
        cluster,
        episodeIndex: idx + 1,
        endpointId: options.endpointId,
        maintenanceWindows,
        flappingThreshold,
        minUnplannedOutageMs,
        estimatedDetectionSeconds,
      })
    );

    const totalWindowMs = windowEndMs - windowStartMs;
    const totalWindowMinutes = Number((totalWindowMs / 60_000).toFixed(2));

    const scheduledMaintenanceMs = MaintenanceWindow.computeMergedOverlapMs(
      maintenanceWindows,
      options.windowStart,
      options.windowEnd,
      options.endpointId
    );
    const scheduledMaintenanceMinutes = Number((scheduledMaintenanceMs / 60_000).toFixed(2));
    const eligibleServiceMs = Math.max(0, totalWindowMs - scheduledMaintenanceMs);
    const eligibleServiceMinutes = Number((eligibleServiceMs / 60_000).toFixed(2));

    const allRawIntervals = this.mergeIntervals(
      clippedRecords.map((r) => ({ startMs: r.clippedStartMs, endMs: r.clippedEndMs }))
    );
    const rawDowntimeMs = allRawIntervals.reduce(
      (acc, range) => acc + (range.endMs - range.startMs),
      0
    );

    const excludedMaintenanceDowntimeMs = allRawIntervals.reduce(
      (acc, range) =>
        acc +
        MaintenanceWindow.computeMergedOverlapMs(
          maintenanceWindows,
          new Date(range.startMs),
          new Date(range.endMs),
          options.endpointId
        ),
      0
    );

    const suppressedHysteresisDowntimeMs = episodes
      .filter((ep) => ep.isSuppressedMicroOutage)
      .reduce((acc, ep) => acc + Math.round(ep.unplannedOutageMinutes * 60_000), 0);

    const effectiveUnplannedDowntimeMs = Math.max(
      0,
      rawDowntimeMs - excludedMaintenanceDowntimeMs - suppressedHysteresisDowntimeMs
    );

    const rawDowntimeMinutes = Number((rawDowntimeMs / 60_000).toFixed(2));
    const excludedMaintenanceDowntimeMinutes = Number(
      (excludedMaintenanceDowntimeMs / 60_000).toFixed(2)
    );
    const suppressedHysteresisDowntimeMinutes = Number(
      (suppressedHysteresisDowntimeMs / 60_000).toFixed(2)
    );
    const effectiveUnplannedDowntimeMinutes = Number(
      (effectiveUnplannedDowntimeMs / 60_000).toFixed(2)
    );

    const rawUptimePercentage =
      totalWindowMs > 0
        ? this.clampPercentage(((totalWindowMs - rawDowntimeMs) / totalWindowMs) * 100)
        : 100;

    const adjustedUptimePercentage =
      eligibleServiceMs > 0
        ? this.clampPercentage(
            ((eligibleServiceMs - Math.min(eligibleServiceMs, effectiveUnplannedDowntimeMs)) /
              eligibleServiceMs) *
              100
          )
        : 100;

    const slaCountingEpisodes = episodes.filter((ep) => ep.countsTowardSlaBreach);
    const flappingEpisodesCount = episodes.filter((ep) => ep.isFlapping).length;
    const maintenanceCoveredEpisodesCount = episodes.filter(
      (ep) => ep.maintenanceCoverage === 'FULLY_COVERED_BY_MAINTENANCE'
    ).length;
    const suppressedMicroOutagesCount = episodes.filter(
      (ep) => ep.isSuppressedMicroOutage
    ).length;

    const meanTimeToDetectSeconds =
      slaCountingEpisodes.length > 0
        ? Number(
            (
              slaCountingEpisodes.reduce((acc, ep) => acc + ep.timeToDetectSeconds, 0) /
              slaCountingEpisodes.length
            ).toFixed(2)
          )
        : 0;

    const acknowledgedValues = slaCountingEpisodes
      .map((ep) => ep.timeToAcknowledgeMinutes)
      .filter((val): val is number => val !== null);

    const meanTimeToAcknowledgeMinutes =
      acknowledgedValues.length > 0
        ? Number(
            (
              acknowledgedValues.reduce((acc, val) => acc + val, 0) / acknowledgedValues.length
            ).toFixed(2)
          )
        : null;

    const resolvedMttrValues = slaCountingEpisodes
      .map((ep) => ep.effectiveMttrMinutes)
      .filter((val): val is number => val !== null);

    const meanTimeToResolveMinutes =
      resolvedMttrValues.length > 0
        ? Number(
            (
              resolvedMttrValues.reduce((acc, val) => acc + val, 0) / resolvedMttrValues.length
            ).toFixed(2)
          )
        : null;

    const operationalEligibleHours =
      Math.max(0, eligibleServiceMs - effectiveUnplannedDowntimeMs) / 3_600_000;
    const meanTimeBetweenFailuresHours =
      slaCountingEpisodes.length > 0
        ? Number((operationalEligibleHours / slaCountingEpisodes.length).toFixed(2))
        : null;

    return {
      endpointId: options.endpointId,
      windowStart: options.windowStart.toISOString(),
      windowEnd: options.windowEnd.toISOString(),
      totalWindowMinutes,
      scheduledMaintenanceMinutes,
      eligibleServiceMinutes,
      rawDowntimeMinutes,
      excludedMaintenanceDowntimeMinutes,
      suppressedHysteresisDowntimeMinutes,
      effectiveUnplannedDowntimeMinutes,
      rawUptimePercentage,
      adjustedUptimePercentage,
      totalRawIncidents: clippedRecords.length,
      coalescedEpisodesCount: episodes.length,
      unplannedEpisodesCount: slaCountingEpisodes.length,
      flappingEpisodesCount,
      maintenanceCoveredEpisodesCount,
      suppressedMicroOutagesCount,
      meanTimeToDetectSeconds,
      meanTimeToAcknowledgeMinutes,
      meanTimeToResolveMinutes,
      meanTimeBetweenFailuresHours,
      episodes: Object.freeze(episodes),
    };
  }

  private clipAndSortIncidents(
    incidents: readonly Incident[],
    endpointId: string,
    windowStartMs: number,
    windowEndMs: number
  ): ClippedIncidentRecord[] {
    const records: ClippedIncidentRecord[] = [];

    for (const incident of incidents) {
      if (incident.endpointId !== endpointId) {
        continue;
      }

      const rawStartMs = incident.startedAt.getTime();
      const isOngoing = incident.resolvedAt === null || incident.isOpen();
      const rawEndMs = incident.resolvedAt ? incident.resolvedAt.getTime() : windowEndMs;

      if (rawEndMs <= windowStartMs || rawStartMs >= windowEndMs) {
        continue;
      }

      const clippedStartMs = Math.max(rawStartMs, windowStartMs);
      const clippedEndMs = Math.min(Math.max(rawEndMs, clippedStartMs), windowEndMs);

      if (clippedEndMs <= clippedStartMs) {
        continue;
      }

      const isOngoingAtWindowEnd =
        isOngoing || (incident.resolvedAt !== null && incident.resolvedAt.getTime() > windowEndMs);

      records.push({
        incident,
        clippedStartMs,
        clippedEndMs,
        isOngoingAtWindowEnd,
      });
    }

    records.sort(
      (a, b) => a.clippedStartMs - b.clippedStartMs || a.clippedEndMs - b.clippedEndMs
    );
    return records;
  }

  private clusterByHysteresisGap(
    records: readonly ClippedIncidentRecord[],
    coalesceGapMs: number
  ): ClippedIncidentRecord[][] {
    if (records.length === 0) {
      return [];
    }

    const first = records[0];
    if (!first) {
      return [];
    }

    const clusters: ClippedIncidentRecord[][] = [[first]];
    let currentClusterEndMs = first.clippedEndMs;

    for (let i = 1; i < records.length; i += 1) {
      const record = records[i];
      const activeCluster = clusters[clusters.length - 1];
      if (!record || !activeCluster) {
        continue;
      }

      const recoveryGapMs = record.clippedStartMs - currentClusterEndMs;
      if (recoveryGapMs <= coalesceGapMs) {
        activeCluster.push(record);
        currentClusterEndMs = Math.max(currentClusterEndMs, record.clippedEndMs);
      } else {
        clusters.push([record]);
        currentClusterEndMs = record.clippedEndMs;
      }
    }

    return clusters;
  }

  private buildEpisode(params: {
    cluster: readonly ClippedIncidentRecord[];
    episodeIndex: number;
    endpointId: string;
    maintenanceWindows: readonly MaintenanceWindow[];
    flappingThreshold: number;
    minUnplannedOutageMs: number;
    estimatedDetectionSeconds: number;
  }): CoalescedIncidentEpisode {
    const {
      cluster,
      episodeIndex,
      endpointId,
      maintenanceWindows,
      flappingThreshold,
      minUnplannedOutageMs,
      estimatedDetectionSeconds,
    } = params;

    const firstRecord = cluster[0];
    if (!firstRecord) {
      throw new Error('No se puede construir un episodio coalescido a partir de un clúster vacío');
    }

    const episodeStartMs = firstRecord.clippedStartMs;
    let episodeEndMs = firstRecord.clippedEndMs;
    let highestSeverity: IncidentSeverity = firstRecord.incident.severity;
    let isOngoing = false;
    let totalConsecutiveFailures = 0;
    let earliestAckMs: number | null = null;
    let resolvedRootCause: string | null = null;

    const subIncidentIds: string[] = [];
    const rawTimelineEvents: IncidentTimelineEvent[] = [];

    for (const item of cluster) {
      subIncidentIds.push(item.incident.id);
      episodeEndMs = Math.max(episodeEndMs, item.clippedEndMs);

      if (
        IncidentReliabilityService.SEVERITY_RANK[item.incident.severity] >
        IncidentReliabilityService.SEVERITY_RANK[highestSeverity]
      ) {
        highestSeverity = item.incident.severity;
      }

      if (item.isOngoingAtWindowEnd) {
        isOngoing = true;
      }

      totalConsecutiveFailures += Math.max(1, item.incident.consecutiveFailures);

      if (item.incident.acknowledgedAt) {
        const ackMs = item.incident.acknowledgedAt.getTime();
        if (earliestAckMs === null || ackMs < earliestAckMs) {
          earliestAckMs = ackMs;
        }
      }

      if (!resolvedRootCause && item.incident.rootCause) {
        resolvedRootCause = item.incident.rootCause;
      }

      for (const tl of item.incident.timeline) {
        rawTimelineEvents.push(tl);
      }
    }

    const mergedOutageIntervals = this.mergeIntervals(
      cluster.map((c) => ({ startMs: c.clippedStartMs, endMs: c.clippedEndMs }))
    );

    const wallClockDurationMs = Math.max(0, episodeEndMs - episodeStartMs);
    const rawOutageMs = mergedOutageIntervals.reduce(
      (acc, interval) => acc + (interval.endMs - interval.startMs),
      0
    );
    const interFlapRecoveryMs = Math.max(0, wallClockDurationMs - rawOutageMs);

    const excludedMaintenanceMs = mergedOutageIntervals.reduce(
      (acc, interval) =>
        acc +
        MaintenanceWindow.computeMergedOverlapMs(
          maintenanceWindows,
          new Date(interval.startMs),
          new Date(interval.endMs),
          endpointId
        ),
      0
    );

    const unplannedOutageMs = Math.max(0, rawOutageMs - excludedMaintenanceMs);

    let maintenanceCoverage: EpisodeMaintenanceCoverage = 'UNPLANNED_OUTAGE';
    if (rawOutageMs > 0 && excludedMaintenanceMs >= rawOutageMs) {
      maintenanceCoverage = 'FULLY_COVERED_BY_MAINTENANCE';
    } else if (excludedMaintenanceMs > 0) {
      maintenanceCoverage = 'PARTIALLY_EXCLUDED';
    }

    const flapCount = cluster.length;
    const isFlapping = flapCount >= flappingThreshold;

    const isSuppressedMicroOutage =
      maintenanceCoverage !== 'FULLY_COVERED_BY_MAINTENANCE' &&
      unplannedOutageMs > 0 &&
      unplannedOutageMs < minUnplannedOutageMs;

    const countsTowardSlaBreach =
      unplannedOutageMs > 0 && !isSuppressedMicroOutage;

    const rawStartForAckMs = firstRecord.incident.startedAt.getTime();
    const timeToAcknowledgeMinutes =
      earliestAckMs !== null
        ? Number((Math.max(0, earliestAckMs - rawStartForAckMs) / 60_000).toFixed(2))
        : null;

    const unplannedOutageMinutes = Number((unplannedOutageMs / 60_000).toFixed(2));
    const effectiveMttrMinutes = isOngoing ? null : unplannedOutageMinutes;

    const sortedTimeline = [...rawTimelineEvents].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    if (cluster.length > 1) {
      sortedTimeline.push({
        id: `tl_coalesced_${firstRecord.incident.id}_${cluster.length}`,
        timestamp: new Date(episodeEndMs).toISOString(),
        author: 'PulseTrack Reliability Engine',
        type: 'UPDATE',
        message: `Coalescencia por histéresis: ${cluster.length} sub-incidentes agrupados (${isFlapping ? 'FLAPPING DETECTADO' : 'micro-cortes correlacionados'}).`,
      });
    }

    const episodeId =
      cluster.length === 1
        ? firstRecord.incident.id
        : `ep_${firstRecord.incident.id}_c${episodeIndex}`;

    return {
      episodeId,
      endpointId,
      subIncidentIds: Object.freeze(subIncidentIds),
      severity: highestSeverity,
      isOngoing,
      startedAt: new Date(episodeStartMs).toISOString(),
      endedAt: new Date(episodeEndMs).toISOString(),
      acknowledgedAt: earliestAckMs !== null ? new Date(earliestAckMs).toISOString() : null,
      flapCount,
      isFlapping,
      totalConsecutiveFailures,
      wallClockDurationMinutes: Number((wallClockDurationMs / 60_000).toFixed(2)),
      rawOutageMinutes: Number((rawOutageMs / 60_000).toFixed(2)),
      interFlapRecoveryMinutes: Number((interFlapRecoveryMs / 60_000).toFixed(2)),
      excludedMaintenanceMinutes: Number((excludedMaintenanceMs / 60_000).toFixed(2)),
      unplannedOutageMinutes,
      maintenanceCoverage,
      isSuppressedMicroOutage,
      countsTowardSlaBreach,
      timeToDetectSeconds: estimatedDetectionSeconds,
      timeToAcknowledgeMinutes,
      effectiveMttrMinutes,
      primarySummary: firstRecord.incident.summary,
      rootCause: resolvedRootCause,
      mergedTimeline: Object.freeze(sortedTimeline),
    };
  }

  private mergeIntervals(intervals: readonly TimeIntervalRange[]): TimeIntervalRange[] {
    if (intervals.length === 0) {
      return [];
    }

    const sorted = [...intervals].sort(
      (a, b) => a.startMs - b.startMs || a.endMs - b.endMs
    );

    const first = sorted[0];
    if (!first) {
      return [];
    }

    const merged: { startMs: number; endMs: number }[] = [
      { startMs: first.startMs, endMs: first.endMs },
    ];

    for (let i = 1; i < sorted.length; i += 1) {
      const current = sorted[i];
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

  private clampPercentage(value: number): number {
    return Math.max(0, Math.min(100, Number(value.toFixed(4))));
  }
}
