import type { PanelStageOciEnqueueResult } from '@/lib/oci/enqueue-panel-stage-outbox';

import { logWarn } from '@/lib/logging/logger';

/** 
 * When true, panel routes return non-2xx if OCI producer did not persist a durable artifact. 
 * Default: false (optional hardening).
 */
export function isPanelOciFailClosed(): boolean {
  const v = (process.env.OCI_PANEL_OCI_FAIL_CLOSED ?? '').trim().toLowerCase();
  const isEnabled = v === '1' || v === 'true' || v === 'yes';
  
  if (!isEnabled && process.env.NODE_ENV === 'production') {
    logWarn('panel_oci_fail_closed_disabled', {
      msg: 'OCI_PANEL_OCI_FAIL_CLOSED is false in production. OCI artifact failures will not block HTTP responses.',
    });
  }
  
  return isEnabled;
}

export type PanelOciClassification = 'processed' | 'partial_failure' | 'reconciled_skip';

export function classifyPanelOciEnqueue(oci: PanelStageOciEnqueueResult): {
  classification: PanelOciClassification;
  artifact_written: boolean;
  producer_ok: boolean;
} {
  const artifact_written = oci.outboxInserted;
  const producer_ok = oci.ok;
  if (!producer_ok) {
    return { classification: 'partial_failure', artifact_written, producer_ok };
  }
  if (!artifact_written && oci.reconciliationPersisted) {
    return { classification: 'reconciled_skip', artifact_written, producer_ok };
  }
  return { classification: 'processed', artifact_written, producer_ok };
}

/** JSON fields for panel OCI contract (additive). */
export function panelOciResponseFields(oci: PanelStageOciEnqueueResult): Record<string, unknown> {
  const c = classifyPanelOciEnqueue(oci);
  return {
    oci_classification: c.classification,
    oci_artifact_written: c.artifact_written,
    oci_producer_ok: c.producer_ok,
  };
}

/** HTTP status for route envelope when producer did not persist a durable artifact. */
export function panelOciProducerHttpStatus(oci: PanelStageOciEnqueueResult): number {
  if (!oci.ok && isPanelOciFailClosed()) return 503;
  return 200;
}

/** Top-level `success` aligned with HTTP when fail-closed is enabled. */
export function panelOciRouteSuccess(oci: PanelStageOciEnqueueResult): boolean {
  if (!oci.ok && isPanelOciFailClosed()) return false;
  return true;
}
