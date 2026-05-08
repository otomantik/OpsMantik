import { ExportRunIntegrityStatus } from './export-run-reconciliation';

export interface PromotionWaiver {
  owner?: string;
  reason?: string;
  expiry?: string;
  blast_radius?: string;
}

export interface PromotionPolicyInput {
  mode: 'static' | 'local' | 'staging' | 'production';
  strict: boolean;
  export_run_integrity: ExportRunIntegrityStatus;
  checked_equations?: string[];
  missing_equations?: string[];
  mismatch_reasons?: string[];
  waiver?: PromotionWaiver | null;
}

export interface PromotionPolicyOutput {
  pass: boolean;
  status: string;
  blocking_reasons: string[];
  warnings: string[];
  waiver_required: boolean;
  waiver_accepted: boolean;
}

export function evaluateExportRunPromotionPolicy(input: PromotionPolicyInput): PromotionPolicyOutput {
  const isStatic = input.mode === 'static';
  const isStrict = input.strict && !isStatic; // Static is never strict-gated on runtime evidence

  const output: PromotionPolicyOutput = {
    pass: true,
    status: 'POLICY_PASSED',
    blocking_reasons: [],
    warnings: [],
    waiver_required: false,
    waiver_accepted: false
  };

  if (isStatic) {
    if (input.export_run_integrity === 'STATIC_EXPORT_CONTRACT_GREEN') {
      return output;
    }
    // If not green, still pass but warn
    output.warnings.push(`Static mode defaults to pass, but integrity is ${input.export_run_integrity}`);
    return output;
  }

  if (!isStrict) {
    if (input.export_run_integrity === 'EXPORT_RUN_INTEGRITY_RED') {
      output.warnings.push('RED integrity ignored due to non-strict mode');
    }
    return output;
  }

  // Strict mode evaluation
  if (input.export_run_integrity === 'EXPORT_RUN_INTEGRITY_RED') {
    output.pass = false;
    output.status = 'POLICY_FAILED';
    output.blocking_reasons.push('EXPORT_RUN_INTEGRITY_RED is a hard blocker and cannot be waived');
    return output;
  }

  if (input.export_run_integrity === 'EXPORT_RUN_INTEGRITY_GREEN') {
    return output;
  }

  // PARTIAL or UNVERIFIED
  output.waiver_required = true;

  if (input.waiver) {
    const missingWaiverFields = [];
    if (!input.waiver.owner) missingWaiverFields.push('owner');
    if (!input.waiver.reason) missingWaiverFields.push('reason');
    if (!input.waiver.expiry) missingWaiverFields.push('expiry');
    if (!input.waiver.blast_radius) missingWaiverFields.push('blast_radius');

    if (missingWaiverFields.length > 0) {
      output.pass = false;
      output.status = 'POLICY_FAILED_INVALID_WAIVER';
      output.blocking_reasons.push(`Waiver missing required fields: ${missingWaiverFields.join(', ')}`);
      return output;
    }

    // Check expiry
    const expiryDate = new Date(input.waiver.expiry!);
    if (isNaN(expiryDate.getTime()) || expiryDate.getTime() < Date.now()) {
      output.pass = false;
      output.status = 'POLICY_FAILED_EXPIRED_WAIVER';
      output.blocking_reasons.push('Waiver is expired or has invalid expiry date');
      return output;
    }

    output.waiver_accepted = true;
    output.status = 'POLICY_PASSED_WITH_WAIVER';
    output.warnings.push(`Promotion waived by ${input.waiver.owner}. Reason: ${input.waiver.reason}`);
    return output;
  }

  // No waiver provided
  output.pass = false;
  output.status = 'POLICY_FAILED_MISSING_WAIVER';
  output.blocking_reasons.push(`Strict promotion requires GREEN or a valid waiver. Current state: ${input.export_run_integrity}`);
  return output;
}
