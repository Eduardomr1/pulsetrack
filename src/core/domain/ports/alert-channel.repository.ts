import { AlertChannel } from '../entities/alert-channel.entity';

export interface IAlertChannelRepository {
  findById(id: string): Promise<AlertChannel | null>;
  findAll(): Promise<AlertChannel[]>;
  save(channel: AlertChannel): Promise<void>;
  update(channel: AlertChannel): Promise<void>;
  delete(id: string): Promise<void>;
  countAlertsSentSince(channelId: string, since: Date): Promise<number>;
}
