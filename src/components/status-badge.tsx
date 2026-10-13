'use client';

import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react';
import {
  getStatusVisualConfig,
  NormalizedHealthStatus,
} from '@/presentation/view-models/status-presentation';

export interface StatusBadgeProps {
  status: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  animated?: boolean;
  showIcon?: boolean;
  showLabel?: boolean;
  useShortLabel?: boolean;
  customLabel?: string;
  className?: string;
}

/**
 * Badge reactivo y accesible con animación de pulso/ping en tiempo real.
 * Verde para OPERATIONAL / HEALTHY, ámbar para DEGRADED, rojo para DOWN.
 */
export function StatusBadge({
  status,
  size = 'md',
  animated = true,
  showIcon = true,
  showLabel = true,
  useShortLabel = false,
  customLabel,
  className = '',
}: StatusBadgeProps) {
  const config = getStatusVisualConfig(status);

  // Dimensiones según tamaño
  const sizeClasses = {
    sm: {
      badge: 'px-2 py-0.5 text-[10px] gap-1.5',
      icon: 'w-3 h-3',
      dot: 'w-1.5 h-1.5',
      ping: 'w-1.5 h-1.5',
    },
    md: {
      badge: 'px-2.5 py-1 text-[11px] gap-1.5',
      icon: 'w-3.5 h-3.5',
      dot: 'w-2 h-2',
      ping: 'w-2 h-2',
    },
    lg: {
      badge: 'px-3 py-1.5 text-xs gap-2 font-semibold',
      icon: 'w-4 h-4',
      dot: 'w-2.5 h-2.5',
      ping: 'w-2.5 h-2.5',
    },
  }[size];

  const renderIcon = (norm: NormalizedHealthStatus) => {
    switch (norm) {
      case 'OPERATIONAL':
        return <CheckCircle2 className={`${sizeClasses.icon} text-emerald-400 shrink-0`} aria-hidden="true" />;
      case 'DEGRADED':
        return <AlertTriangle className={`${sizeClasses.icon} text-amber-400 shrink-0`} aria-hidden="true" />;
      case 'DOWN':
        return <XCircle className={`${sizeClasses.icon} text-red-400 shrink-0`} aria-hidden="true" />;
      default:
        return <HelpCircle className={`${sizeClasses.icon} text-slate-400 shrink-0`} aria-hidden="true" />;
    }
  };

  const label = customLabel ?? (useShortLabel ? config.shortLabel : config.label);

  return (
    <span
      role="status"
      aria-label={`Estado: ${config.label}. ${config.ariaDescription}`}
      title={config.ariaDescription}
      className={`inline-flex items-center rounded-full font-mono font-bold border backdrop-blur-sm transition-all duration-300 ${config.badgeClass} ${sizeClasses.badge} ${className}`}
    >
      {/* Animated Ping / Pulse Dot */}
      <span className="relative flex items-center justify-center" aria-hidden="true">
        {animated && config.status !== 'UNKNOWN' && (
          <span
            className={`absolute inline-flex rounded-full opacity-75 animate-ping ${config.pingClass} ${sizeClasses.ping}`}
          />
        )}
        <span
          className={`relative inline-flex rounded-full transition-transform duration-200 ${config.dotClass} ${sizeClasses.dot}`}
        />
      </span>

      {/* Semantic Icon */}
      {showIcon && renderIcon(config.status)}

      {/* Text Label */}
      {showLabel && <span className="tracking-wide uppercase font-sans text-white/90">{label}</span>}
    </span>
  );
}
