'use client';

import { useState } from 'react';
import { Globe, RefreshCw, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

export interface RegionalResultItem {
  regionCode: string;
  regionName: string;
  location: string;
  flag: string;
  statusCode: number | null;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  latency: {
    dnsLookupMs: number;
    tcpConnectMs: number;
    tlsHandshakeMs: number;
    ttfbMs: number;
    contentTransferMs: number;
    totalMs: number;
  };
  deltaFromBaselineMs: number;
  errorMessage: string | null;
}

interface MultiRegionGridProps {
  endpointId: string;
  initialRegions?: RegionalResultItem[];
}

export function MultiRegionGrid({ endpointId, initialRegions }: MultiRegionGridProps) {
  const [regions, setRegions] = useState<RegionalResultItem[]>(initialRegions ?? []);
  const [loading, setLoading] = useState<boolean>(false);

  const runMultiRegionProbe = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/endpoints/${endpointId}/multi-region`, {
        method: 'POST',
      });
      const json = await res.json();
      if (json.success && json.data.regions) {
        setRegions(json.data.regions);
      }
    } catch (err) {
      console.error('Error al ejecutar sondeo multi-región:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0d1424] p-6 shadow-xl space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-cyan-400" />
          <div>
            <h3 className="text-base font-bold text-white">
              Sondeo Sintético Multi-Región Global
            </h3>
            <p className="text-xs text-slate-400">
              Monitoreo distribuido desde nodos edge en América, Europa y Asia-Pacífico
            </p>
          </div>
        </div>

        <button
          onClick={runMultiRegionProbe}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-cyan-300 border border-slate-700 flex items-center gap-2 transition disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          <span>{loading ? 'Sondando Nodos Globales...' : 'Sondar Todas las Regiones'}</span>
        </button>
      </div>

      {regions.length === 0 ? (
        <div className="text-center py-8 px-4 rounded-xl border border-dashed border-slate-800 text-xs text-slate-500">
          Haz clic en &quot;Sondar Todas las Regiones&quot; para medir la latencia global en tiempo real desde 4 continentes.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {regions.map((r) => {
            const isHealthy = r.status === 'HEALTHY';
            const isDegraded = r.status === 'DEGRADED';
            const isDown = r.status === 'DOWN';

            return (
              <div
                key={r.regionCode}
                className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3 hover:border-slate-700 transition"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl" role="img" aria-label={r.regionName}>
                      {r.flag}
                    </span>
                    <div>
                      <h4 className="font-bold text-white text-xs leading-none">{r.regionName}</h4>
                      <span className="text-[10px] text-slate-400 font-mono">{r.regionCode}</span>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${
                      isHealthy
                        ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-400'
                        : isDegraded
                        ? 'border-amber-500/30 bg-amber-950/20 text-amber-400'
                        : 'border-red-500/30 bg-red-950/20 text-red-400'
                    }`}
                  >
                    {isHealthy && <CheckCircle2 className="w-3 h-3" />}
                    {isDegraded && <AlertTriangle className="w-3 h-3" />}
                    {isDown && <XCircle className="w-3 h-3" />}
                    <span>{r.status}</span>
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-slate-400">Latencia Total</span>
                    <span className="text-xl font-black text-amber-300">
                      {r.latency.totalMs.toFixed(1)} <span className="text-xs font-normal text-slate-400">ms</span>
                    </span>
                  </div>

                  {r.deltaFromBaselineMs !== 0 && (
                    <div className="text-[11px] font-mono text-right text-slate-400">
                      <span className="text-slate-500">$\Delta$ Base: </span>
                      <span className={r.deltaFromBaselineMs > 0 ? 'text-amber-400' : 'text-emerald-400'}>
                        {r.deltaFromBaselineMs > 0 ? `+${r.deltaFromBaselineMs}` : r.deltaFromBaselineMs}ms
                      </span>
                    </div>
                  )}
                </div>

                {/* Sub-phase mini stats */}
                <div className="grid grid-cols-3 gap-1 pt-2 border-t border-slate-800/60 text-[10px] font-mono text-center">
                  <div className="p-1 rounded bg-slate-950/40">
                    <span className="text-slate-500 block">DNS</span>
                    <span className="text-indigo-400 font-bold">{r.latency.dnsLookupMs}m</span>
                  </div>
                  <div className="p-1 rounded bg-slate-950/40">
                    <span className="text-slate-500 block">TCP</span>
                    <span className="text-cyan-400 font-bold">{r.latency.tcpConnectMs}m</span>
                  </div>
                  <div className="p-1 rounded bg-slate-950/40">
                    <span className="text-slate-500 block">TTFB</span>
                    <span className="text-emerald-400 font-bold">{r.latency.ttfbMs}m</span>
                  </div>
                </div>

                {r.errorMessage && (
                  <p className="text-[10px] text-red-400 font-mono truncate" title={r.errorMessage}>
                    {r.errorMessage}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
