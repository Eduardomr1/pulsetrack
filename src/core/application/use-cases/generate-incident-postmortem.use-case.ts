import { IIncidentRepository } from '../../domain/ports/incident.repository';
import { IEndpointRepository } from '../../domain/ports/endpoint.repository';
import {
  IncidentPostmortemService,
  StructuredPostmortem,
  SlaCreditTier,
} from '../../domain/services/incident-postmortem.service';

export interface GenerateIncidentPostmortemInput {
  incidentId: string;
  targetSlaPercentage?: number;
  windowTotalMinutes?: number;
  customTiers?: SlaCreditTier[];
}

export class GenerateIncidentPostmortemUseCase {
  constructor(
    private readonly incidentRepository: IIncidentRepository,
    private readonly endpointRepository: IEndpointRepository
  ) {}

  public async execute(
    input: GenerateIncidentPostmortemInput
  ): Promise<StructuredPostmortem> {
    const incident = await this.incidentRepository.findById(input.incidentId);
    if (!incident) {
      throw new Error(`Incident with ID "${input.incidentId}" not found.`);
    }

    const endpoint = await this.endpointRepository.findById(incident.endpointId);
    if (!endpoint) {
      throw new Error(`Endpoint with ID "${incident.endpointId}" not found.`);
    }

    return IncidentPostmortemService.generate(incident, endpoint, {
      targetSlaPercentage: input.targetSlaPercentage,
      windowTotalMinutes: input.windowTotalMinutes,
      customTiers: input.customTiers,
    });
  }
}
