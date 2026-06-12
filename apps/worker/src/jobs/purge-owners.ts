import { prisma } from '@app/db';

/**
 * Purga los registros de titular vencidos (`expiresAt < now()`) para cumplir la
 * minimización/retención de datos personales (FR-050, SC-007). Ejecutar de forma
 * programada (cron) o manualmente vía `npm run purge`.
 */
export async function purgeExpiredOwners(): Promise<number> {
  const { count } = await prisma.ownerRecord.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  purgeExpiredOwners()
    .then((n) => {
      console.log(`[purge] ${n} registros de titular vencidos eliminados`);
      return prisma.$disconnect();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
