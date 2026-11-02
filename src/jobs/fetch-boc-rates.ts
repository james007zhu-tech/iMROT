/** Daily job: pull Bank of China rates and upsert FxRate rows. Schedule at 17:00 Asia/Bangkok (after BoC's last afternoon publish). */
import { PrismaClient } from "@prisma/client";
import { fetchBocRates, toFxRate } from "../lib/fx/boc";

const prisma = new PrismaClient();

async function main() {
  const rows = await fetchBocRates();
  const today = new Date();
  const rateDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  let n = 0;
  for (const row of rows) {
    if (row.middle == null) continue;
    const fx = toFxRate(row, rateDate);
    await prisma.fxRate.upsert({
      where: { rateDate_currency_source: { rateDate, currency: fx.currency, source: "BOC" } },
      update: { rateToCny: fx.rateToCny, buyRemit: fx.buyRemit ?? undefined, sellRemit: fx.sellRemit ?? undefined, publishedAt: fx.publishedAt ?? undefined, fetchedAt: new Date() },
      create: { ...fx, buyRemit: fx.buyRemit ?? undefined, sellRemit: fx.sellRemit ?? undefined, publishedAt: fx.publishedAt ?? undefined },
    });
    n++;
  }
  console.log(`BOC rates stored for ${rateDate.toISOString().slice(0, 10)}: ${n} currencies`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
