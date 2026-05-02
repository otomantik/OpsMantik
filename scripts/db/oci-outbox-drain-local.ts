/**
 * Drains one batch of pending outbox_events using production logic + .env.local
 * service-role (same DB as console). Used when HTTPS worker returns an empty 500 or
 * cron lock blocks /api/cron/oci/process-outbox-events.
 *
 *   node --import tsx scripts/db/oci-outbox-drain-local.ts
 *   node --import tsx scripts/db/oci-outbox-drain-local.ts --loops=10
 *
 * First dynamic import may take tens of seconds on cold start (large module graph).
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const loopsArg =
  typeof process.argv.find((a) => a.startsWith('--loops=')) === 'string'
    ? Number(process.argv.find((a) => a.startsWith('--loops='))?.split('=')[1])
    : 1;
const maxLoops =
  typeof loopsArg === 'number' && Number.isFinite(loopsArg) && loopsArg >= 1
    ? Math.min(50, loopsArg)
    : 1;

async function main(): Promise<void> {
  console.error('[oci-outbox-drain-local] importing runProcessOutbox…');
  const { runProcessOutbox } = await import('@/lib/oci/outbox/process-outbox');

  for (let i = 0; i < maxLoops; i++) {
    const result = await runProcessOutbox();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      console.error('[oci-outbox-drain-local] stopping: ok=false');
      process.exitCode = 1;
      break;
    }
    if (result.message === 'no_pending_events' || result.claimed === 0) {
      break;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
