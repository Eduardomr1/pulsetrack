export interface LatencyMetricsProps {
  dnsLookupMs: number;
  tcpConnectMs: number;
  tlsHandshakeMs: number;
  ttfbMs: number;
  contentTransferMs: number;
  totalMs: number;
}

export class LatencyBreakdownVo {
  public readonly dnsLookupMs: number;
  public readonly tcpConnectMs: number;
  public readonly tlsHandshakeMs: number;
  public readonly ttfbMs: number;
  public readonly contentTransferMs: number;
  public readonly totalMs: number;

  constructor(props: LatencyMetricsProps) {
    this.dnsLookupMs = Math.max(0, Math.round(props.dnsLookupMs * 100) / 100);
    this.tcpConnectMs = Math.max(0, Math.round(props.tcpConnectMs * 100) / 100);
    this.tlsHandshakeMs = Math.max(0, Math.round(props.tlsHandshakeMs * 100) / 100);
    this.ttfbMs = Math.max(0, Math.round(props.ttfbMs * 100) / 100);
    this.contentTransferMs = Math.max(0, Math.round(props.contentTransferMs * 100) / 100);
    this.totalMs = Math.max(0, Math.round(props.totalMs * 100) / 100);
  }

  public static zero(): LatencyBreakdownVo {
    return new LatencyBreakdownVo({
      dnsLookupMs: 0,
      tcpConnectMs: 0,
      tlsHandshakeMs: 0,
      ttfbMs: 0,
      contentTransferMs: 0,
      totalMs: 0,
    });
  }

  public toJSON(): LatencyMetricsProps {
    return {
      dnsLookupMs: this.dnsLookupMs,
      tcpConnectMs: this.tcpConnectMs,
      tlsHandshakeMs: this.tlsHandshakeMs,
      ttfbMs: this.ttfbMs,
      contentTransferMs: this.contentTransferMs,
      totalMs: this.totalMs,
    };
  }
}
