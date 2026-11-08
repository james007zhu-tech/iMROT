/** Daily job: pull Bank of China rates and upsert FxRate rows. Schedule at 17:00 Asia/Bangkok (after BoC's last afternoon publish). */
import { prisma } from "../lib/db";
import { refreshBocRates } from "../server/fx";

refreshBocRates()
  .then((r) => console.log(`BOC rates stored for ${r.rateDate}: ${r.count} currencies`))
  .catch((e) => { console.error((e as Error).message); process.exit(1); })
  .finally(() => prisma.$disconnect());
