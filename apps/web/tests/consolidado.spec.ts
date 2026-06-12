import { test, expect } from '@playwright/test';
import { sampleReport, mockApi } from './helpers';

test.describe('US3 — reporte consolidado', () => {
  test('muestra "Próximamente" y el disclaimer', async ({ page }) => {
    await mockApi(page, sampleReport());
    await page.goto('/reporte/ABC123');
    await expect(page.getByText('Próximamente').first()).toBeVisible();
    await expect(page.getByText('Papeletas e infracciones')).toBeVisible();
    await expect(page.getByText('referencial', { exact: false })).toBeVisible();
  });

  test('degrada a reporte parcial cuando una fuente no responde', async ({ page }) => {
    await mockApi(page, sampleReport({ partial: true }));
    await page.goto('/reporte/ABC123');
    await expect(page.getByText('Reporte parcial')).toBeVisible();
    await expect(page.getByText('no disponible', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reintentar' }).first()).toBeVisible();
  });

  test('muestra SOAT vigente en la sección de seguros', async ({ page }) => {
    await mockApi(page, sampleReport());
    await page.goto('/reporte/ABC123');
    await expect(page.getByText('SOAT vigente')).toBeVisible();
    await expect(page.getByText('LA POSITIVA')).toBeVisible();
  });
});
