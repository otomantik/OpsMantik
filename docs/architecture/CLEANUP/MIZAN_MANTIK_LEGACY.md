# `lib/domain/mizan-mantik` — legacy scope

**Status:** Intentional **legacy / strangler** domain code. It remains listed under `ignore` in [`knip.json`](../../../knip.json) so Knip does not treat the tree as dead code to delete in bulk.

**Product decision required before removal:** Confirm no active tenant flows, migrations, or operator runbooks depend on this module. When removing or migrating, delete the `knip.json` ignore glob first, then remove or relocate files with `npm run test:release-gates` and any affected smoke tests.

**Do not** delete this directory in a Knip-only PR without the above sign-off.
