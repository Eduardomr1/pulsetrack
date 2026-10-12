import { AssertionVo } from '../../core/domain/value-objects/assertion.vo';
import { RawProbeResult } from './http-telemetry-agent';

export interface AssertionEvaluationResult {
  passed: boolean;
  failures: string[];
}

export class AssertionEvaluator {
  public static evaluate(
    assertions: AssertionVo[],
    expectedStatusCodes: number[],
    probe: RawProbeResult
  ): AssertionEvaluationResult {
    const failures: string[] = [];

    // 1. Evaluate Status Code against expected status codes
    if (probe.statusCode !== null) {
      if (!expectedStatusCodes.includes(probe.statusCode)) {
        failures.push(
          `Código de estado inesperado: ${probe.statusCode} (esperado: [${expectedStatusCodes.join(', ')}])`
        );
      }
    } else {
      failures.push(`Sin respuesta HTTP: ${probe.errorMessage ?? 'Error de conexión'}`);
    }

    // 2. Evaluate Custom Assertions
    for (const assertion of assertions) {
      const failure = this.evaluateSingle(assertion, probe);
      if (failure) {
        failures.push(failure);
      }
    }

    return {
      passed: failures.length === 0,
      failures,
    };
  }

  private static evaluateSingle(
    assertion: AssertionVo,
    probe: RawProbeResult
  ): string | null {
    switch (assertion.target) {
      case 'latency_ms': {
        const actualLatency = probe.latency.totalMs;
        const expected = Number(assertion.expectedValue);
        if (assertion.operator === 'less_than' && actualLatency >= expected) {
          return `Latencia ${actualLatency.toFixed(1)}ms excede el límite SLA de ${expected}ms`;
        }
        if (assertion.operator === 'greater_than' && actualLatency <= expected) {
          return `Latencia ${actualLatency.toFixed(1)}ms es menor que ${expected}ms`;
        }
        break;
      }

      case 'status_code': {
        const actual = probe.statusCode;
        const expected = Number(assertion.expectedValue);
        if (assertion.operator === 'equals' && actual !== expected) {
          return `Código HTTP ${actual} !== ${expected}`;
        }
        if (assertion.operator === 'not_equals' && actual === expected) {
          return `Código HTTP ${actual} === ${expected}`;
        }
        break;
      }

      case 'body_contains': {
        const expected = String(assertion.expectedValue);
        if (!probe.body.includes(expected)) {
          return `El cuerpo de la respuesta no contiene "${expected}"`;
        }
        break;
      }

      case 'body_regex': {
        try {
          const regex = new RegExp(String(assertion.expectedValue));
          if (!regex.test(probe.body)) {
            return `El cuerpo no coincide con regex "${assertion.expectedValue}"`;
          }
        } catch {
          return `Patrón Regex inválido: "${assertion.expectedValue}"`;
        }
        break;
      }

      case 'json_path': {
        if (!assertion.property) {
          return 'Regla JSONPath requiere una propiedad/ruta válida (ej: $.data.status)';
        }
        try {
          const parsed = JSON.parse(probe.body) as unknown;
          const actualVal = this.extractJsonPath(parsed, assertion.property);

          if (actualVal === undefined) {
            return `Propiedad JSONPath "${assertion.property}" no encontrada en la respuesta`;
          }

          const expected = assertion.expectedValue;

          if (assertion.operator === 'equals') {
            if (String(actualVal) !== String(expected) && actualVal !== expected) {
              return `JSONPath "${assertion.property}" es "${String(actualVal)}", esperado "${expected}"`;
            }
          } else if (assertion.operator === 'not_equals') {
            if (String(actualVal) === String(expected) || actualVal === expected) {
              return `JSONPath "${assertion.property}" es igual a "${expected}"`;
            }
          } else if (assertion.operator === 'greater_than') {
            if (Number(actualVal) <= Number(expected)) {
              return `JSONPath "${assertion.property}" (${actualVal}) no es mayor que ${expected}`;
            }
          } else if (assertion.operator === 'less_than') {
            if (Number(actualVal) >= Number(expected)) {
              return `JSONPath "${assertion.property}" (${actualVal}) no es menor que ${expected}`;
            }
          } else if (assertion.operator === 'contains') {
            if (!String(actualVal).includes(String(expected))) {
              return `JSONPath "${assertion.property}" (${String(actualVal)}) no contiene "${expected}"`;
            }
          } else if (assertion.operator === 'matches_regex') {
            const regex = new RegExp(String(expected));
            if (!regex.test(String(actualVal))) {
              return `JSONPath "${assertion.property}" (${String(actualVal)}) no coincide con "${expected}"`;
            }
          }
        } catch {
          return `No se pudo parsear el cuerpo JSON para verificar "${assertion.property}"`;
        }
        break;
      }

      case 'header': {
        if (!assertion.property) break;
        const headerKey = assertion.property.toLowerCase();
        const headerVal = probe.responseHeaders[headerKey];
        if (!headerVal) {
          return `Cabecera "${assertion.property}" no encontrada en la respuesta`;
        }
        if (assertion.operator === 'contains' && !headerVal.includes(String(assertion.expectedValue))) {
          return `Cabecera "${assertion.property}" (${headerVal}) no contiene "${assertion.expectedValue}"`;
        }
        if (assertion.operator === 'equals' && headerVal !== String(assertion.expectedValue)) {
          return `Cabecera "${assertion.property}" (${headerVal}) !== "${assertion.expectedValue}"`;
        }
        break;
      }

      case 'ssl_days_remaining': {
        if (!probe.sslInfo) {
          return 'No se obtuvo información de certificado TLS/SSL';
        }
        const minDays = Number(assertion.expectedValue);
        if (probe.sslInfo.daysRemaining < minDays) {
          return `Certificado SSL expira en ${probe.sslInfo.daysRemaining} días (mínimo requerido: ${minDays} días)`;
        }
        break;
      }
    }

    return null;
  }

  /**
   * Evaluates deep path expressions like:
   * 'data.status', '$.user.id', 'items[0].name', 'count'
   */
  private static extractJsonPath(root: unknown, path: string): unknown {
    const normalized = path.trim().replace(/^\$\.?/, '');
    if (!normalized) return root;

    // Match tokens: dot properties or array brackets e.g. ["items", "[0]", "name"]
    const tokens = normalized.match(/[^.[\]]+|\[\d+\]/g) || [];
    let current: unknown = root;

    for (const token of tokens) {
      if (current === null || current === undefined) return undefined;

      if (token.startsWith('[') && token.endsWith(']')) {
        const idx = parseInt(token.slice(1, -1), 10);
        if (Array.isArray(current)) {
          current = current[idx];
        } else {
          return undefined;
        }
      } else {
        if (typeof current === 'object' && current !== null && token in current) {
          current = (current as Record<string, unknown>)[token];
        } else {
          return undefined;
        }
      }
    }

    return current;
  }
}
