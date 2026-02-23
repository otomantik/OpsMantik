## SSO Roadmap (realistic)

Goal: add **enterprise-grade SSO** to the OpsMantik Console (dashboard/admin) without destabilizing the tracker/ingest pipeline.

### Scope

- **In scope**
  - Console login via **OIDC** (Google Workspace / Azure AD / Okta / Auth0 / Keycloak).
  - Optional **SAML** for enterprises that require it.
  - Role + tenant mapping (site access) after login.
  - Break-glass admin access + auditability.

- **Out of scope (for first pass)**
  - SSO for the tracker script visitors (not applicable).
  - Full SCIM provisioning (can be phased in later).
  - Complex multi-org billing entitlements (later).

### Current state (baseline)

- Auth is via **Supabase Auth** (email/magic-link).
- Multi-tenancy is enforced primarily by **RLS** + server gates.
- Platform admin exists as `public.profiles.role = 'admin'`.

### Recommended architecture

Use **Supabase Auth as the identity broker**, and connect enterprise IdPs via:

- **Phase 1 (preferred)**: OIDC providers (widely available, easier to operate)
- **Phase 2 (enterprise)**: SAML (Supabase SSO/SAML feature depending on plan)

Key principles:

- **Fail-closed**: access to sites is not inferred from email domain alone unless explicitly configured.
- **Least privilege**: new users land as read-only (`analyst`) until mapped.
- **Separation**: identity (Auth) vs authorization (DB roles/RLS).

### Tenant mapping strategies (choose per customer)

1) **Invite-based (default, safest)**
   - Admin invites user → creates `site_members` row with a role.
   - SSO login only proves identity; authorization is driven by `site_members`.
   - Best for high assurance + minimal surprises.

2) **Domain auto-join (optional)**
   - For customers with a verified email domain (e.g. `@customer.com`).
   - New SSO logins auto-join a site with default role `analyst`.
   - Requires: verified domain + explicit enable flag per site.
   - Must include **rate limiting + audit**.

3) **Group-claim mapping (advanced)**
   - Map IdP groups → OpsMantik site role.
   - Requires stable IdP group claims and clear governance.
   - Works best with Okta/AAD + custom claims.

### Minimal data model additions (Phase 1)

Add a small configuration surface per site (or per org if an org layer exists later):

- `sso_enabled` (bool)
- `sso_mode` (`invite_only` | `domain_auto_join` | `group_mapping`)
- `sso_allowed_domains` (text[])
- `sso_default_role` (`analyst` recommended)
- `sso_provider` metadata (issuer, client_id) if needed

If/when multi-org is introduced, move these configs to an `orgs` table.

### Login flow (Phase 1: OIDC)

- User clicks “Continue with <IdP>”
- Supabase Auth redirects to IdP and returns with an authenticated session
- App performs **post-login provisioning**:
  - Ensure `profiles` row exists
  - Determine tenant mapping (invite/domain/group)
  - Ensure `site_members` row exists (if mapping allows)
  - Redirect to `/dashboard` with a deterministic “select site” UX

### Security requirements (must-have)

- **No implicit escalation**:
  - Email domain match must never grant `operator/admin` automatically.
- **Auditability**:
  - Record provisioning decisions (who/what mapped the user to a site).
- **Break-glass**:
  - Keep magic-link login for platform admins (or a dedicated admin-only IdP).
- **Session control**:
  - Short session TTL for privileged roles; support “sign out all sessions”.
- **Replay resistance**:
  - Keep signed-request verification patterns for internal webhooks (already present in project).

### Rollout plan

#### Phase 0 — Prep (1–2 days)
- Document policy: which customers get SSO, who can enable it, and default role behavior.
- Add runbook entry: “SSO login failing” and “User cannot see site after SSO”.

#### Phase 1 — OIDC MVP (3–7 days)
- Add “Continue with Google/Microsoft” buttons (via Supabase Auth providers).
- Implement post-login provisioning hook (server-side):
  - Ensure `profiles`
  - Enforce `invite_only` default
  - Optional: domain auto-join behind feature flag
- Add admin UI to view SSO status + mapping (read-only at first).

Acceptance criteria:
- New SSO user can log in and see **only** sites they’re invited to.
- No write actions are permitted unless role allows it.

#### Phase 2 — Enterprise SAML (1–2 weeks, depends on plan)
- Enable SAML connection in Supabase (or alternative broker if needed).
- Add per-customer SSO metadata docs (issuer, ACS URL, certificate rotation plan).
- Add admin UI for enabling/disabling SSO per tenant.

#### Phase 3 — Group mapping + SCIM (optional, 2–6 weeks)
- Map IdP groups → site roles
- Add SCIM provisioning (if required) or a lightweight bulk-sync job.

### Operational considerations

- **Support playbook**:
  - User can log in but sees no sites → check `site_members`, mapping mode, domain settings.
  - User sees site but cannot act → role/capability mismatch (expected).
- **Monitoring**
  - Track login success/fail, provisioning outcomes, auto-join events.

### Risks & mitigations

- **Risk**: domain auto-join accidentally grants access to wrong users
  - **Mitigation**: invite-only default; domain auto-join requires explicit allow-list + default `analyst`.

- **Risk**: customers expect SSO to replace magic-link entirely
  - **Mitigation**: keep break-glass magic-link for platform admins; document policy.

