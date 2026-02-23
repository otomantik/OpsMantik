# Mission: OpsMantik Ultimate Enterprise (God Mode)
## Persona: Senior System Architect & Prompt Engineer

This document serves as the high-fidelity blueprint for transforming OpsMantik into a Tier-1 Enterprise Intelligence Platform. The objective is to eliminate "Estimation" and replace it with "Deterministic Evidence," providing the end-client with undeniable proof of lead quality through deep-packet data inspection and behavioral heuristics.

---

### Phase 1: The Integrity Core (Advanced Infrastructure)
**Objective:** Capture high-fidelity hardware and network signals to provide "Proof of Humanity" and "Proof of Interest."

**Prompt 1.1: [Hyper-Detailed Session Telemetry]**
> "Alter the `sessions` table to include `browser_language`, `device_memory`, `hardware_concurrency` (CPU cores), `screen_width`, `screen_height`, `pixel_ratio`, and `gpu_renderer` (if available via client-side metadata). Update the `extractGeoInfo` and `SessionService` to ingest these signals. The goal is to create a 'Hardware DNA' for every visitor to detect professional bot farms and verify high-value human targets."

**Prompt 1.2: [Network & Infrastructure Transparency]**
> "Extend session tracking to capture `connection_type` (4g, wifi, etc.), `isp_asn`, and `is_proxy_detected`. Refactor the attribution logic to distinguish between a 'Fresh Click' and an 'Ads Assisted Conversion' by cross-referencing previous session IDs associated with the same fingerprint. Store this as `attribution_journey_depth` (int)."

---

### Phase 2: Behavioral Forensics (Engagement Engine)
**Objective:** Track micro-interactions to prove the "Temperature" of the lead.

**Prompt 2.1: [Pixel-Perfect Behavioral Tracking]**
> "Implement a 'Niyet (Intent) Pulse' mechanism. Track `max_scroll_percentage`, `cta_hover_count`, `form_focus_duration`, and `total_active_seconds` (excluding idle time). Update the `events` sync logic to batch these metrics into the session record upon conversion (intent). This allows us to tell the client: 'This user didn't just click; they read 85% of your landing page and hovered over your pricing for 12 seconds.'"

**Prompt 2.2: [The 'Returning Giant' Logic]**
> "Create a PostgreSQL function and an API logic to calculate `visitor_rank`. If a fingerprint is seen multiple times over 7 days, flag it as 'VETERAN_HUNTER'. Update the UI to show a 'High-Frequency Visitor' badge with the count of previous visits. This provides immediate social proof to the ad advertiser that their remarketing or high-intent SEO is working."

---

### Phase 3: Predator UI v2 (The Command Center)
**Objective:** Visualize the "Deterministic Evidence" with elite aesthetic and data density.

**Prompt 3.1: [Data-Dense HunterCard Architecture]**
> "Refactor `HunterCard.tsx` using a 'Modular Command HUD' design. Use a 4-quadrant layout:
> 1. **ORIGIN (Northwest):** Verified Google Ads Signal (GCLID Deep Link), Keyword, Network Type.
> 2. **IDENTITY (Northeast):** Hardware DNA (Device, ISP, Language, OS).
> 3. **BEHAVIOR (Southwest):** Action Pulse (Scroll Depth, Time on Page, Interaction Count).
> 4. **INTELLIGENCE (Southeast):** AI-generated 'Lead Confidence Score' (0-100) based on weighted signals.
> Apply a 'Semi-Transparent Glass' effect with 'Subtle RGB Glow' based on the lead score (Emerald for 90+, Amber for 50-89, Slate for others)."

**Prompt 3.2: [Micro-Animation Identity]**
> "Add SVG-based micro-animations for the data signals. For example, the 'Carrier/ISP' should have a small pulsing signal tower icon. The 'Verified' badge should have a satisfying checkmark animation. Ensure every piece of information has a 'Tooltip' explaining *why* this data matters (e.g., 'High hardware specs suggest a premium device user')."

---

### Phase 4: Convergence & Reporting (Enterprise Grade)
**Objective:** Final polishing and intelligence reporting.

**Prompt 4.1: [The 'War Room' Dashboard Shell]**
> "Update the `DashboardShell` to include a 'Global System Status' bar. Display real-time stats like 'Total GCLID Verified Leads', 'Average Engagement Rate', and 'Conversion Efficiency'. Implement a 'God Mode' toggle that reveals raw technical metadata for every lead when hovered."

**Prompt 4.2: [Clean & Release Integrity]**
> "Perform a full system audit. Ensure all TypeScript interfaces strictly match the new DB schema. Remove all console logs and dummy counters. Localize every single string into British/American English for a global enterprise feel. Ensure the 'Live View' is optimized for high-frequency traffic (>100 intents/min)."

---

## Strategy Rulebook:
-   **No Placeholders:** Generate real UI assets and icons.
-   **Proof is Power:** Every UI change must answer the question: "How does this prove the lead is real?"
-   **Elite Aesthetics:** Think Bloomberg Terminal meets Modern SaaS (Vercel-like precision).
