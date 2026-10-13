import { NextRequest, NextResponse } from 'next/server';
import { incidentRepository, endpointRepository } from '@/infrastructure/container';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const incident = await incidentRepository.findById(id);

    if (!incident) {
      return NextResponse.json(
        { success: false, error: 'Incidente no encontrado' },
        { status: 404 }
      );
    }

    const endpoint = await endpointRepository.findById(incident.endpointId);
    const { searchParams } = new URL(request.url);
    const format = (searchParams.get('format') ?? 'markdown').toLowerCase();

    const tta = incident.getTimeToAcknowledgeMinutes();
    const ttr = incident.getDurationMinutes();
    const endpointName = endpoint?.name ?? 'Servicio Desconocido';
    const targetUrl = endpoint?.url.value ?? 'N/A';

    if (format === 'json') {
      return NextResponse.json({
        success: true,
        incidentId: incident.id,
        endpointName,
        targetUrl,
        severity: incident.severity,
        status: incident.status,
        metrics: {
          startedAt: incident.startedAt.toISOString(),
          acknowledgedAt: incident.acknowledgedAt?.toISOString() ?? null,
          resolvedAt: incident.resolvedAt?.toISOString() ?? null,
          timeToAcknowledgeMinutes: tta,
          timeToResolveMinutes: ttr,
          consecutiveFailures: incident.consecutiveFailures,
        },
        summary: incident.summary,
        rootCause: incident.rootCause,
        timeline: incident.timeline,
      });
    }

    // Default: Professional Markdown Post-Mortem Document
    const postMortemContent = `# Reporte Post-Mortem de Incidente: ${endpointName}

**ID de Incidente:** \`${incident.id}\`  
**Servicio Afectado:** ${endpointName} (\`${targetUrl}\`)  
**Severidad:** ${incident.severity}  
**Estado:** ${incident.status}  
**Fecha de Inicio:** ${incident.startedAt.toUTCString()}  
**Fecha de Resolución:** ${incident.resolvedAt ? incident.resolvedAt.toUTCString() : 'En curso'}  

---

## 1. Resumen Ejecutivo (Executive Summary)
Durante el monitoreo continuo de **PulseTrack**, se detectó una degradación/caída del servicio **${endpointName}**.
* **Resumen de la Falla:** ${incident.summary}
* **Impacto Total de Disponibilidad:** ${ttr} minutos de inactividad registrados.
* **Fallos Consecutivos Registrados:** ${incident.consecutiveFailures} sondeos fallidos.

---

## 2. Métricas Clave de SRE (Key SRE Recovery Metrics)

| Métrica | Valor | Descripción |
| :--- | :---: | :--- |
| **Tiempo de Detección (TTD)** | $< 5\\text{s}$ | Detección inmediata mediante RED Telemetry Socket Agent |
| **Tiempo de Reconocimiento (TTA)** | ${tta !== null ? `${tta} min` : 'Pendiente'} | Tiempo transcurrido hasta que el ingeniero On-Call tomó el caso |
| **Tiempo Medio de Resolución (TTR)** | ${incident.resolvedAt ? `${ttr} min` : 'En investigación'} | Duración total de la interrupción del servicio |
| **Sondeos Fallidos** | ${incident.consecutiveFailures} | Ráfaga de solicitudes con error o timeout |

---

## 3. Cronología del Incidente (Chronological Timeline)

| Timestamp (UTC) | Actor / Origen | Tipo de Evento | Detalle de la Bitácora |
| :--- | :--- | :---: | :--- |
${incident.timeline
  .map(
    (t) =>
      `| ${new Date(t.timestamp).toUTCString()} | **${t.author ?? 'SRE'}** | \`${t.type}\` | ${t.message} |`
  )
  .join('\n')}

---

## 4. Análisis de Causa Raíz (Root Cause Analysis - 5 Whys)

**Causa Raíz Identificada:**  
> ${incident.rootCause ?? 'En análisis. (Posible saturación de conexiones en el backend o latencia excedida en la base de datos).'}

1. **¿Por qué falló el sondeo?** El servidor no respondió dentro del timeout configurado o arrojó un código de error HTTP.
2. **¿Por qué no respondió a tiempo?** Posible incremento de contención de recursos o bloqueo de hilos.
3. **¿Por qué ocurrió la contención?** Carga imprevista o fallo en la capa de persistencia upstream.
4. **¿Por qué no se amortiguó la carga?** Ausencia de circuit breakers o dimensionamiento insuficiente de réplicas.
5. **¿Por qué no se previno?** Falta de alertas tempranas sobre saturación de memoria antes del umbral crítico.

---

## 5. Medidas Correctivas y Preventivas (Action Items)

- [ ] **[P1]** Implementar reintentos exponenciales con jitter en los clientes dependientes.
- [ ] **[P1]** Ajustar el tamaño del connection pool de base de datos para absorber picos.
- [ ] **[P2]** Revisar la regla de escalado horizontal automático (HPA) en el clúster.
- [ ] **[P3]** Actualizar la documentación del runbook de guardia para este servicio.

---
*Reporte generado automáticamente por PulseTrack Observability & Incident Command System.*
`;

    const sanitizedTitle = `post-mortem-${incident.id}.md`;

    return new NextResponse(postMortemContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${sanitizedTitle}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al generar post-mortem';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
