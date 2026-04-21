import { ConversionBatchArena } from '@/lib/oci/runner/soa-arena';

function fail(message: string): never {
  throw new Error(`RUNTIME_BUDGET_GATE_FAILED: ${message}`);
}

async function main() {
  const rows = Number(process.env.RUNTIME_BUDGET_ROWS ?? 20000);
  const maxLoopMs = Number(process.env.RUNTIME_BUDGET_MAX_LOOP_MS ?? 1200);
  const maxHeapDeltaMb = Number(process.env.RUNTIME_BUDGET_MAX_HEAP_DELTA_MB ?? 64);

  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();

  const arena = new ConversionBatchArena(rows);
  for (let i = 0; i < rows; i++) {
    arena.setStatus(i, (i % 4) as 0 | 1 | 2 | 3);
    arena.setRetryCount(i, i % 8);
    arena.setValueCents(i, i * 100);
    arena.setUpdatedAtMs(i, Date.now());
  }

  let checksum = 0;
  for (let i = 0; i < rows; i++) {
    checksum += arena.getStatus(i);
    checksum += arena.getRetryCount(i);
    checksum += Math.trunc(arena.getValueCents(i));
  }

  const elapsedMs = performance.now() - started;
  const heapAfter = process.memoryUsage().heapUsed;
  const heapDeltaMb = (heapAfter - heapBefore) / (1024 * 1024);

  if (elapsedMs > maxLoopMs) {
    fail(`loop_ms=${elapsedMs.toFixed(2)} exceeds budget=${maxLoopMs}`);
  }
  if (heapDeltaMb > maxHeapDeltaMb) {
    fail(`heap_delta_mb=${heapDeltaMb.toFixed(2)} exceeds budget=${maxHeapDeltaMb}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        rows,
        loop_ms: Number(elapsedMs.toFixed(2)),
        heap_delta_mb: Number(heapDeltaMb.toFixed(2)),
        checksum,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
