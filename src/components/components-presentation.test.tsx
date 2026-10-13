import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusBadge } from './status-badge';
import { LatencySparkline } from './latency-sparkline';
import { RegisterEndpointModal } from './register-endpoint-modal';
import { ServiceStatusCard, ServiceCardData } from './service-status-card';

describe('React Components Presentation & Accessibility Tests', () => {
  describe('<StatusBadge />', () => {
    it('renderiza badge verde esmeralda con rol status y clase animate-ping para OPERATIONAL', () => {
      const html = renderToStaticMarkup(<StatusBadge status="OPERATIONAL" animated={true} useShortLabel={true} />);
      expect(html).toContain('role="status"');
      expect(html).toContain('animate-ping');
      expect(html).toContain('bg-emerald-400');
      expect(html).toContain('border-emerald-500');
      expect(html).toContain('OPERATIONAL');
    });

    it('renderiza badge verde esmeralda para estado HEALTHY', () => {
      const html = renderToStaticMarkup(<StatusBadge status="HEALTHY" />);
      expect(html).toContain('bg-emerald-400');
      expect(html).toContain('Operacional');
    });

    it('renderiza badge ámbar con icono de advertencia para DEGRADED', () => {
      const html = renderToStaticMarkup(<StatusBadge status="DEGRADED" animated={true} />);
      expect(html).toContain('role="status"');
      expect(html).toContain('bg-amber-400');
      expect(html).toContain('border-amber-500');
      expect(html).toContain('Degradado');
    });

    it('renderiza badge rojo con icono de corte para DOWN', () => {
      const html = renderToStaticMarkup(<StatusBadge status="DOWN" animated={true} />);
      expect(html).toContain('role="status"');
      expect(html).toContain('bg-red-400');
      expect(html).toContain('border-red-500');
      expect(html).toContain('Interrupción');
    });

    it('respeta la prop customLabel y el tamaño lg', () => {
      const html = renderToStaticMarkup(
        <StatusBadge status="OPERATIONAL" size="lg" customLabel="SISTEMA ACTIVO" />
      );
      expect(html).toContain('SISTEMA ACTIVO');
      expect(html).toContain('px-3');
    });
  });

  describe('<LatencySparkline />', () => {
    it('renderiza elemento SVG con role="img" y aria-label accesible con milisegundos', () => {
      const sampleData = [
        { value: 45.2, timestamp: '2026-10-12T10:00:00Z' },
        { value: 50.8, timestamp: '2026-10-12T10:01:00Z' },
        { value: 62.1, timestamp: '2026-10-12T10:02:00Z' },
      ];

      const html = renderToStaticMarkup(
        <LatencySparkline data={sampleData} showStats={true} title="Latencia Gateway" />
      );

      expect(html).toContain('role="img"');
      expect(html).toContain('aria-label');
      expect(html).toContain('Promedio');
      expect(html).toContain('ms');
      expect(html).toContain('<path'); // Path de línea y área
      expect(html).toContain('linearGradient'); // Gradiente SVG
      expect(html).toContain('Prom:'); // Estadísticas visibles
    });

    it('renderiza estado amigable cuando no hay datos', () => {
      const html = renderToStaticMarkup(<LatencySparkline data={[]} />);
      expect(html).toContain('Sin muestras de latencia');
    });

    it('renderiza línea guía de SLA cuando se especifica slaThresholdMs', () => {
      const html = renderToStaticMarkup(
        <LatencySparkline data={[20, 40, 80]} slaThresholdMs={50} />
      );
      expect(html).toContain('stroke-dasharray="3 3"');
    });
  });

  describe('<RegisterEndpointModal />', () => {
    it('no renderiza nada cuando isOpen es false', () => {
      const html = renderToStaticMarkup(
        <RegisterEndpointModal isOpen={false} onClose={() => {}} onSuccess={() => {}} />
      );
      expect(html).toBe('');
    });

    it('renderiza diálogo accesible con selector de método HTTP e intervalo cuando isOpen es true', () => {
      const html = renderToStaticMarkup(
        <RegisterEndpointModal isOpen={true} onClose={() => {}} onSuccess={() => {}} />
      );

      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('id="register-endpoint-title"');
      expect(html).toContain('Registrar Nuevo Endpoint de Monitoreo');
      expect(html).toContain('aria-label="Cerrar modal de registro"');
      expect(html).toContain('GET');
      expect(html).toContain('POST');
      expect(html).toContain('Intervalo de Sondeo');
      expect(html).toContain('SLA Latencia Máx.');
    });
  });

  describe('<ServiceStatusCard />', () => {
    const mockService: ServiceCardData = {
      id: 'ep-test-1',
      name: 'Authentication API',
      url: 'https://auth.example.com/oauth/health',
      method: 'GET',
      intervalSeconds: 30,
      timeoutMs: 5000,
      isActive: true,
      tags: ['production', 'security'],
      latestCheck: {
        id: 'chk-1',
        timestamp: '2026-10-12T12:00:00Z',
        status: 'HEALTHY',
        statusCode: 200,
        latency: {
          dnsLookupMs: 4.2,
          tcpConnectMs: 8.5,
          tlsHandshakeMs: 15.3,
          ttfbMs: 32.0,
          contentTransferMs: 2.1,
          totalMs: 62.1,
        },
        sslInfo: {
          valid: true,
          issuer: "Let's Encrypt",
          validTo: '2026-12-31T23:59:59Z',
          daysRemaining: 80,
        },
        failedAssertions: [],
        errorMessage: null,
      },
      historyBuckets: [
        {
          bucketIndex: 0,
          startTime: '2026-10-12T00:00:00Z',
          endTime: '2026-10-12T01:00:00Z',
          status: 'HEALTHY',
          sampleCount: 120,
          uptimePercentage: 100,
          avgLatencyMs: 58.4,
        },
      ],
      aggregates: {
        totalChecks: 120,
        healthyChecks: 120,
        degradedChecks: 0,
        downChecks: 0,
        uptimePercentage: 100,
        avgLatencyMs: 58.4,
        p50LatencyMs: 55,
        p95LatencyMs: 68,
        p99LatencyMs: 74,
      },
    };

    it('renderiza la tarjeta completa con badge animado, URL, método, sparkline y desglose de socket', () => {
      const html = renderToStaticMarkup(
        <ServiceStatusCard
          service={mockService}
          onProbe={() => {}}
          onToggleActive={() => {}}
          onEdit={() => {}}
        />
      );

      expect(html).toContain('Authentication API');
      expect(html).toContain('https://auth.example.com/oauth/health');
      expect(html).toContain('GET');
      expect(html).toContain('role="status"'); // StatusBadge
      expect(html).toContain('ACTIVO');
      expect(html).toContain('100.00%');
      expect(html).toContain('62.1 ms');
      expect(html).toContain('Desglose de Socket &amp; RED Telemetry');
      expect(html).toContain('DNS: 4.2ms');
      expect(html).toContain('Sondar Ahora');
    });
  });
});
