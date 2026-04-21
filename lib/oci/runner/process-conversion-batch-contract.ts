import type { UploadResult } from '@/lib/providers/types';
import type { QueueRow } from '@/lib/cron/process-offline-conversions';

export interface ProcessBatchInput {
  siteId: string;
  providerKey: string;
  rows: QueueRow[];
  credentials: unknown;
  prefix: string;
  failClosedOnMismatch: boolean;
  mismatchIds: ReadonlySet<string>;
}

export interface ProcessBatchResult {
  completed: number;
  failed: number;
  retry: number;
  poisonIds: string[];
  blockedValueIds: string[];
  uploadResults: UploadResult[] | undefined;
  providerRequestId: string | null;
  errorCode: string | null;
  errorCategory: string | null;
}
