# Trust, BCP, email

## Cookies / consent

- GDPR routes: [`GDPR_RETENTION_MAP.md`](./GDPR_RETENTION_MAP.md)
- Panel cookies: Supabase SSR cookies — `sameSite: 'lax'`, `secure: true` in [`lib/supabase/middleware.ts`](../../lib/supabase/middleware.ts).

## Email

Search periodically:

`rg "sendMail|resend|postmark|nodemailer|@sendgrid" app lib`

Document any hit here with owner and prod usage (yes/no).

## BCP / DR

- Supabase PITR and backup expectations are **vendor-defined** — record RPO/RTO assumptions in internal ops wiki; no code change required for slimdown.
