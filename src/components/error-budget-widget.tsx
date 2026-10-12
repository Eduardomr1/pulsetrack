'use client';

import { Target, AlertCircle, CheckCircle2, Flame } from 'lucide-react';
import { SloReport } from '@/core/domain/services/slo-calculator.service';

interface ErrorBudgetWidgetProps {
  report: SloReport;
}

export function ErrorBudgetWidget({ report }: ErrorBudgetWidgetProps) {
  const isHealthy = report.burnStatus === 'HEALTHY';
  const isElevated = report.burnStatus === 'ELEVATED';
  const isCritical = report.burnStatus === 'CRITICAL';

  const budgetColor =
    report.remainingBudgetPercentage > 50
      ? 'bg-emerald-500'
      : report.remainingBudgetPercentage > 15
      ? 'bg-amber-500'
      : 'bg-red-500';

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0d1424] p-6 shadow-xl space-y-5">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-cyan-400" />
          <h3 className="text-base font-bold text-white">
            SRE Service Level Objective & Error Budget (30d)
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2.5 py-0.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
              isHealthy
                ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-400'
                : isElevated
                ? 'border-amber-500/30 bg-amber-950/20 text-amber-400'
                : 'border-red-500/30 bg-red-950/20 text-red-400'
            }`}
          >
            {isHealthy && <CheckCircle2 className="w-3.5 h-3.5" />}
            {isElevated && <Flame className="w-3.5 h-3.5" />}
            {isCritical && <AlertCircle className="w-3.5 h-3.5" />}
            <span>Burn Rate: {report.burnRate.toFixed(1)}x</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {/* Target SLO */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
          <span className="text-[11px] font-semibold uppercase text-slate-400">Objetivo SLO</span>
          <div className="text-2xl font-black text-cyan-400">{report.targetSloPercentage}%</div>
          <span className="text-[10px] text-slate-500">Compromiso mensual</span>
        </div>

        {/* Current Availability */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
          <span className="text-[11px] font-semibold uppercase text-slate-400">Disponibilidad Real</span>
          <div
            className={`text-2xl font-black ${
              report.isBreached ? 'text-red-400' : 'text-emerald-400'
            }`}
          >
            {report.currentAvailabilityPercentage}%
          </div>
          <span className="text-[10px] text-slate-500">
            {report.isBreached ? 'Brecha detectada' : 'En cumplimiento'}
          </span>
        </div>

        {/* Presupuesto Restante */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
          <span className="text-[11px] font-semibold uppercase text-slate-400">Error Budget Restante</span>
          <div className="text-2xl font-black text-amber-300">
            {report.remainingBudgetPercentage}%
          </div>
          <span className="text-[10px] text-slate-500">
            {report.remainingBudgetMinutes} min restantes
          </span>
        </div>

        {/* Inactividad Consumida */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
          <span className="text-[11px] font-semibold uppercase text-slate-400">Inactividad Consumida</span>
          <div className="text-2xl font-black text-slate-200">
            {report.consumedDowntimeMinutes}m / {report.allowedDowntimeMinutes}m
          </div>
          <span className="text-[10px] text-slate-500">Límite 30 días</span>
        </div>
      </div>

      {/* Progress Bar of Remaining Error Budget */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Consumo de Presupuesto de Error</span>
          <span className="font-mono">{report.remainingBudgetPercentage}% disponible</span>
        </div>
        <div className="h-3 w-full rounded-full bg-slate-800 overflow-hidden shadow-inner p-0.5">
          <div
            style={{ width: `${Math.max(2, Math.min(100, report.remainingBudgetPercentage))}%` }}
            className={`h-full rounded-full transition-all duration-500 ${budgetColor}`}
          />
        </div>
      </div>

      <p className="text-[11px] text-slate-400 border-t border-slate-800/60 pt-3">
        {report.downtimeEstimateExplanation} Si el Burn Rate supera 1.0x, la tasa de error consumirá el presupuesto antes del cierre del ciclo mensual.
      </p>
    </div>
  );
}
