/**
 * Phase 20: Gear-Strategy Engine — Registry mapping OpsGear to implementation.
 */

import type { OpsGear } from '../types';
import type { AbstractGear } from './AbstractGear';
import { V1PageViewGear } from './V1PageViewGear';
import { V2PulseGear } from './V2PulseGear';
import { V3EngageGear } from './V3EngageGear';
import { V4IntentGear } from './V4IntentGear';
import { V5SealGear } from './V5SealGear';

const registry = new Map<OpsGear, AbstractGear>([
  ['V1_PAGEVIEW', new V1PageViewGear()],
  ['V2_PULSE', new V2PulseGear()],
  ['V3_ENGAGE', new V3EngageGear()],
  ['V4_INTENT', new V4IntentGear()],
  ['V5_SEAL', new V5SealGear()],
]);

export function getGear(gear: OpsGear): AbstractGear {
  const g = registry.get(gear);
  if (!g) throw new Error(`Unknown gear: ${gear}`);
  return g;
}
