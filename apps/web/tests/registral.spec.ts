import { test, expect } from '@playwright/test';
import { sampleReport, mockApi } from './helpers';

test.describe('US1 — datos registrales', () => {
  test('búsqueda desde el inicio lleva al reporte registral', async ({ page }) => {
    await mockApi(page, sampleReport());
    await page.goto('/');
    await page.getByLabel('Número de placa').fill('ABC-123');
    await page.getByRole('button', { name: 'Consultar' }).click();

    await expect(page).toHaveURL(/\/reporte\/ABC123/);
    await expect(page.getByText('TOYOTA', { exact: false })).toBeVisible();
    await expect(page.getByText('Datos registrales')).toBeVisible();
    await expect(page.getByText('SUNARP', { exact: false }).first()).toBeVisible();
  });

  test('rechaza una placa inválida sin navegar', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Número de placa').fill('xx');
    await page.getByRole('button', { name: 'Consultar' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('alert')).toContainText('placa');
  });

  test('muestra la alerta de robo cuando aplica', async ({ page }) => {
    await mockApi(page, sampleReport({ stolen: true }));
    await page.goto('/reporte/ABC123');
    await expect(page.getByRole('alert')).toContainText('robado');
  });
});
