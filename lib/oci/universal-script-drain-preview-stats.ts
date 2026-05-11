/**
 * PR-9I — Non-sensitive aggregates for preview/diagnostics (QueueRow fetch window).
 */
import type { QueueRow } from '@/lib/oci/google-ads-export/types';
import { resolveUploadIdentifier } from '@/lib/oci/universal-click-id-selection';
import { extractHashedPhoneFromExportSources } from '@/lib/oci/hashed-phone-courier';

export type UniversalScriptDrainPreviewStats = {
  gclid_present_count: number;
  wbraid_present_count: number;
  gbraid_present_count: number;
  selected_gclid_count: number;
  selected_wbraid_count: number;
  selected_gbraid_count: number;
  multiple_click_ids_count: number;
  hashed_phone_only_count: number;
  universal_script_exportable_count: number;
  universal_script_not_exportable_count: number;
};

export function computeUniversalScriptDrainPreviewStats(rows: QueueRow[]): UniversalScriptDrainPreviewStats {
  let gclid_present_count = 0;
  let wbraid_present_count = 0;
  let gbraid_present_count = 0;
  let selected_gclid_count = 0;
  let selected_wbraid_count = 0;
  let selected_gbraid_count = 0;
  let multiple_click_ids_count = 0;
  let hashed_phone_only_count = 0;
  let universal_script_exportable_count = 0;
  let universal_script_not_exportable_count = 0;

  for (const row of rows) {
    const g = row.gclid?.trim();
    const w = row.wbraid?.trim();
    const gb = row.gbraid?.trim();
    if (g) gclid_present_count += 1;
    if (w) wbraid_present_count += 1;
    if (gb) gbraid_present_count += 1;

    const hpCourier = extractHashedPhoneFromExportSources({ row }).hashedPhoneNumber != null;
    const idRes = resolveUploadIdentifier(
      { gclid: row.gclid, wbraid: row.wbraid, gbraid: row.gbraid },
      { hasVerifiedHashedPhoneCourier: hpCourier }
    );

    if (idRes.valid) {
      universal_script_exportable_count += 1;
      if (idRes.selectedType === 'gclid') selected_gclid_count += 1;
      if (idRes.selectedType === 'wbraid') selected_wbraid_count += 1;
      if (idRes.selectedType === 'gbraid') selected_gbraid_count += 1;
      if (idRes.multipleClickIds) multiple_click_ids_count += 1;
    } else {
      universal_script_not_exportable_count += 1;
      if (idRes.reason === 'HASHED_PHONE_ONLY_SCRIPT_LANE_UNSUPPORTED') hashed_phone_only_count += 1;
    }
  }

  return {
    gclid_present_count,
    wbraid_present_count,
    gbraid_present_count,
    selected_gclid_count,
    selected_wbraid_count,
    selected_gbraid_count,
    multiple_click_ids_count,
    hashed_phone_only_count,
    universal_script_exportable_count,
    universal_script_not_exportable_count,
  };
}
