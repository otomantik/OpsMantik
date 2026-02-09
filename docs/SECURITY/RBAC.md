## RBAC v2 (Enterprise-ready)

This project uses **two layers of roles**:

- **Platform role** (`public.profiles.role`): `user` | `admin`
  - `admin` (platform admin) can access/manage all sites (break-glass / support).
- **Site role** (`public.site_members.role` + implicit `sites.user_id` owner):
  - `owner` (implicit): `sites.user_id = auth.uid()`
  - `admin`: site-level administrator (can manage members + operate queue + edit site config)
  - `operator`: operations role (can operate Qualification Queue: seal/junk/undo/cancel)
  - `analyst`: read-only (can view dashboard/queue, cannot mutate)
  - `billing`: billing-only (reserved for future billing UI; no queue mutations)

### Role matrix (capabilities)

- **owner**
  - **members:manage**: yes
  - **site:write**: yes (config)
  - **queue:operate**: yes (seal/junk/undo/cancel)
  - **billing:view**: yes

- **admin**
  - **members:manage**: yes
  - **site:write**: yes
  - **queue:operate**: yes
  - **billing:view**: yes

- **operator**
  - **members:manage**: no
  - **site:write**: no
  - **queue:operate**: yes
  - **billing:view**: no

- **analyst**
  - **members:manage**: no
  - **site:write**: no
  - **queue:operate**: no
  - **billing:view**: no

- **billing**
  - **members:manage**: no
  - **site:write**: no
  - **queue:operate**: no
  - **billing:view**: yes

### Enforcement points

- **Database (RLS)**
  - `calls` SELECT: any accessible member can read
  - `calls` UPDATE/INSERT/DELETE: only `owner` or site role in (`admin`,`operator`) or platform admin
  - `call_actions` INSERT: only `owner` or site role in (`admin`,`operator`) or platform admin
  - `site_members` management: only `owner` or site role `admin` or platform admin
  - `sites` UPDATE: only `owner` or site role in (`admin`,`operator`) or platform admin

- **Server gate**
  - `validateSiteAccess()` returns the site role and is used by mutating API routes.

- **UI capability mapping**
  - `lib/auth/rbac.ts` maps roles → capabilities.
  - Qualification Queue disables **seal/junk/undo/cancel** UI for read-only roles.

### Migration notes

Legacy role values are mapped as:

- `viewer` → `analyst`
- `editor` → `operator`
- `owner` → `admin`

Site “owner” remains implicit via `sites.user_id`.

