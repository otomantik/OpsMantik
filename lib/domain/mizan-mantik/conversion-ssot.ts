export const OCI_CONVERSION_SSOT = {
  junk: 'OpsMantik_Junk_Exclusion',
  contacted: 'OpsMantik_Contacted',
  offered: 'OpsMantik_Offered',
  won: 'OpsMantik_Won',
} as const;

export type OciCanonicalStage = keyof typeof OCI_CONVERSION_SSOT;

export function resolveOciConversionName(stage: OciCanonicalStage): string {
  return OCI_CONVERSION_SSOT[stage];
}

export function isOciCanonicalStage(value: string): value is OciCanonicalStage {
  return value in OCI_CONVERSION_SSOT;
}
