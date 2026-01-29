/**
 * GO2: Badge status label (connectivity vs activity).
 * Pure function for testability and consistent labeling.
 */
export type BadgeStatus = 'disconnected' | 'connected' | 'active';

export interface BadgeStatusInput {
  isConnected: boolean;
  lastSignalAt: Date | null;
}

/**
 * Returns badge status from realtime state.
 * - !isConnected -> disconnected
 * - isConnected && !lastSignalAt -> connected
 * - isConnected && lastSignalAt -> active
 */
export function getBadgeStatus(input: BadgeStatusInput): BadgeStatus {
  if (!input.isConnected) return 'disconnected';
  if (!input.lastSignalAt) return 'connected';
  return 'active';
}
