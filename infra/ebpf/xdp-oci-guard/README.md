# xdp-oci-guard

Kernel-level load shedding program for OCI protection.

## Behavior

- Reads `PG_SATURATION[1]` as external saturation signal.
- Fail-open by default: if `DROP_MODE[1] = 0`, all packets pass.
- Guarded drop only when all conditions are true:
  - `DROP_MODE[1] = 1`
  - `PG_SATURATION[1] >= SAFE_THRESHOLD`
  - packet is IPv4 and destination port matches `TARGET_PORT[1]` (default `443`)
- Every dropped packet increments `DROP_COUNTER[1]`.

## Operational Notes

- Intended for Linux hosts only.
- Must be deployed with lane kill-switch in app orchestrator.
- Always canary first, then gradual rollout.
- Emergency rollback is always `DROP_MODE[1]=0` plus XDP detach.

## Maps

- `PG_SATURATION[1]` -> saturation percentage.
- `DROP_MODE[1]` -> `0` fail-open, `1` guarded-drop.
- `TARGET_PORT[1]` -> protected destination port (default 443).
- `DROP_COUNTER[1]` -> total drops.

## Attach / Detach (example)

- Attach: `ip link set dev eth0 xdp obj xdp_oci_guard.o sec xdp_oci_guard`
- Detach: `ip link set dev eth0 xdp off`
