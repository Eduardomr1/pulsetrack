export type AlertChannelType = 'WEBHOOK' | 'SLACK' | 'DISCORD';
export type AlertEventType = 'DOWN' | 'DEGRADED' | 'RECOVERED';

export interface WebhookConfig {
  webhookUrl: string;
  secretKey?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface SlackConfig {
  webhookUrl: string;
  channel?: string;
  mentionOnCritical?: boolean; // @channel if DOWN
}

export interface DiscordConfig {
  webhookUrl: string;
  username?: string;
  avatarUrl?: string;
  mentionRoleId?: string; // Ping role ID if DOWN
}

export type ChannelConfig = WebhookConfig | SlackConfig | DiscordConfig;

export interface AlertChannelProps {
  id: string;
  name: string;
  type: AlertChannelType;
  config: ChannelConfig;
  events: AlertEventType[];
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class AlertChannel {
  public readonly id: string;
  public name: string;
  public readonly type: AlertChannelType;
  public config: ChannelConfig;
  public events: AlertEventType[];
  public isEnabled: boolean;
  public readonly createdAt: Date;
  public updatedAt: Date;

  constructor(props: AlertChannelProps) {
    if (!props.name || props.name.trim().length === 0) {
      throw new Error('El nombre del canal de alerta no puede estar vacío');
    }

    this.id = props.id;
    this.name = props.name.trim();
    this.type = props.type;
    this.config = props.config;
    this.events = props.events.length > 0 ? props.events : ['DOWN', 'RECOVERED'];
    this.isEnabled = props.isEnabled;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  public shouldNotify(eventType: AlertEventType): boolean {
    return this.isEnabled && this.events.includes(eventType);
  }

  public enable(): void {
    this.isEnabled = true;
    this.updatedAt = new Date();
  }

  public disable(): void {
    this.isEnabled = false;
    this.updatedAt = new Date();
  }
}
