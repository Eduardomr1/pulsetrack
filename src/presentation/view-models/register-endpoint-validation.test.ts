import { describe, it, expect } from 'vitest';
import {
  isValidHttpUrl,
  validateRegisterEndpointForm,
  HTTP_METHODS,
  INTERVAL_PRESETS,
  SLA_PRESETS,
} from './register-endpoint-validation';

describe('register-endpoint-validation (Validación & Presets de Registro de Endpoints)', () => {
  describe('isValidHttpUrl', () => {
    it('acepta URLs HTTP y HTTPS válidas', () => {
      expect(isValidHttpUrl('https://api.empresa.com/v1/health')).toBe(true);
      expect(isValidHttpUrl('http://localhost:3000/api/status')).toBe(true);
      expect(isValidHttpUrl('https://status.github.com')).toBe(true);
    });

    it('rechaza esquemas no permitidos como ftp, ws, mailto', () => {
      expect(isValidHttpUrl('ftp://ftp.empresa.com')).toBe(false);
      expect(isValidHttpUrl('ws://stream.socket.io')).toBe(false);
      expect(isValidHttpUrl('mailto:admin@empresa.com')).toBe(false);
    });

    it('rechaza strings inválidos o vacíos', () => {
      expect(isValidHttpUrl('')).toBe(false);
      expect(isValidHttpUrl('not-a-valid-url')).toBe(false);
      expect(isValidHttpUrl('   ')).toBe(false);
    });
  });

  describe('validateRegisterEndpointForm', () => {
    it('valida exitosamente un formulario completo y válido', () => {
      const result = validateRegisterEndpointForm({
        name: 'API Core Gateway',
        url: 'https://gateway.internal.net/health',
        method: 'GET',
        intervalSeconds: 30,
        timeoutMs: 5000,
        slaLatencyMs: 300,
      });

      expect(result.isValid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });

    it('falla si el nombre está vacío o es muy corto', () => {
      const resEmpty = validateRegisterEndpointForm({
        name: '',
        url: 'https://api.example.com',
        method: 'GET',
        intervalSeconds: 30,
      });
      expect(resEmpty.isValid).toBe(false);
      expect(resEmpty.errors.name).toContain('obligatorio');

      const resShort = validateRegisterEndpointForm({
        name: 'A',
        url: 'https://api.example.com',
        method: 'GET',
        intervalSeconds: 30,
      });
      expect(resShort.isValid).toBe(false);
      expect(resShort.errors.name).toContain('al menos 2 caracteres');
    });

    it('falla si la URL es inválida', () => {
      const result = validateRegisterEndpointForm({
        name: 'Billing Service',
        url: 'ftp://invalido.com',
        method: 'POST',
        intervalSeconds: 60,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.url).toBeDefined();
    });

    it('falla si el intervalo es menor a 5 segundos', () => {
      const result = validateRegisterEndpointForm({
        name: 'Microservice X',
        url: 'https://api.example.com',
        method: 'GET',
        intervalSeconds: 2,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.intervalSeconds).toContain('mínimo de sondeo es de 5 segundos');
    });

    it('falla si el SLA o el timeout están fuera de rango permitido', () => {
      const result = validateRegisterEndpointForm({
        name: 'Database API',
        url: 'https://db.example.com',
        method: 'GET',
        intervalSeconds: 30,
        timeoutMs: 100, // Menor a 500ms
        slaLatencyMs: 5, // Menor a 20ms
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.timeoutMs).toBeDefined();
      expect(result.errors.slaLatencyMs).toBeDefined();
    });
  });

  describe('Presets y constantes', () => {
    it('contiene los 7 métodos HTTP estándar', () => {
      expect(HTTP_METHODS).toEqual([
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'HEAD',
        'OPTIONS',
      ]);
    });

    it('contiene presets de intervalo válidos (10s, 30s, 60s, etc)', () => {
      expect(INTERVAL_PRESETS.length).toBeGreaterThanOrEqual(4);
      expect(INTERVAL_PRESETS.some((p) => p.seconds === 30)).toBe(true);
      expect(INTERVAL_PRESETS.some((p) => p.seconds === 10)).toBe(true);
    });

    it('contiene presets de SLA estándar', () => {
      expect(SLA_PRESETS.length).toBeGreaterThanOrEqual(3);
      expect(SLA_PRESETS.some((p) => p.ms === 500)).toBe(true);
    });
  });
});
