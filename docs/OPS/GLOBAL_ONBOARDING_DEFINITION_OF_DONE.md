# Global Onboarding Definition of Done

A release is complete only if all checks pass:

1. Super admin can create site with:
   - name
   - domain
   - language
   - country
   - timezone
   - currency
2. Site creation auto-seeds origin registry entries.
3. No manual Vercel `ALLOWED_ORIGINS` edit required for standard onboarding.
4. Tracker embed API returns proxy-first script by default.
5. Super admin sees full site list and add-site controls.
6. Worker tenant map resolves newly created site without static `SITE_CONFIG` edit.
7. `npm run smoke:intent-multi-site` passes.
8. No P0/P1 regression detected in first 72 hours.
