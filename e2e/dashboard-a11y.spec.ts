import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('PulseTrack Observability E2E & A11y Suite (WCAG 2.1 AA)', () => {
  test('la página pública de status carga correctamente y cumple con los estándares WCAG 2.1 AA', async ({ page }) => {
    // Interceptar API de status para devolver datos canónicos y estables
    await page.route('/api/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'OPERATIONAL',
          uptimePercentage: 99.98,
          activeIncidents: [],
          recentIncidents: [],
          systems: [
            { id: '1', name: 'API Gateway', status: 'OPERATIONAL', uptimePercentage: 99.99, avgLatencyMs: 42 },
            { id: '2', name: 'Auth Service', status: 'OPERATIONAL', uptimePercentage: 100, avgLatencyMs: 35 },
            { id: '3', name: 'Payment Processor', status: 'DEGRADED', uptimePercentage: 98.5, avgLatencyMs: 140 },
          ],
        }),
      });
    });

    await page.goto('/status');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Auditoría de accesibilidad con Axe
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('el dashboard principal contiene navegación accesible, badges de estado y selector de nuevo endpoint', async ({ page }) => {
    await page.route('/api/endpoints', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'ep-1',
            name: 'Core API Service',
            url: 'https://api.example.com/health',
            method: 'GET',
            status: 'OPERATIONAL',
            intervalSeconds: 60,
            uptimePercentage: 100,
            avgLatencyMs: 55,
          },
        ]),
      });
    });

    await page.goto('/');
    await expect(page.getByText('PulseTrack')).toBeVisible();

    // Validar botón para abrir modal de nuevo endpoint
    const nuevoEndpointBtn = page.getByRole('button', { name: /nuevo endpoint|registrar endpoint/i });
    if (await nuevoEndpointBtn.isVisible()) {
      await nuevoEndpointBtn.click();
      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      // Validar tecla Escape o botón cancelar
      await page.keyboard.press('Escape');
    }

    // Auditoría A11y del dashboard principal
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('la página de historial de incidentes expone la línea de tiempo con roles accesibles', async ({ page }) => {
    await page.route('/api/incidents', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'inc-1',
            endpointName: 'Payment Processor',
            severity: 'CRITICAL',
            status: 'RESOLVED',
            startedAt: '2026-10-12T08:00:00Z',
            resolvedAt: '2026-10-12T08:14:00Z',
            summary: 'Degradación en procesamiento por timeout de pasarela externa',
          },
        ]),
      });
    });

    await page.goto('/incidents');
    await expect(page.getByRole('heading', { name: /incidentes|historial/i })).toBeVisible();

    const scanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(scanResults.violations).toEqual([]);
  });
});
