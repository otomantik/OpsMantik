import { requireQstashSignature } from '@/lib/qstash/require-signature';
import { executeIngest } from '@/lib/ingest/execute-ingest-command';

export const runtime = 'nodejs';

/**
 * Legacy Ingest Endpoint (Defaulting to Telemetry)
 * @deprecated Use /api/workers/ingest/telemetry or /api/workers/ingest/conversion
 */
export const POST = requireQstashSignature((req) => executeIngest(req, 'telemetry'));
