# Call Monitor Source Fields Enrichment Plan

**Date**: 2026-01-27  
**Purpose**: Define source/channel enrichment for Call Monitor without Ads API dependency  
**Status**: Design Complete

---

## Executive Summary

This report defines how to enrich Call Monitor with source/channel information using available data (attribution_source, UTM parameters, referrer, GCLID) without requiring Google Ads API integration. Keyword enrichment is deferred to future Ads API integration.

---

## A. Current Call Monitor Data

### Available Fields (from `components/dashboard/call-alert.tsx`)

**Call Object** (lines 20-41):
```typescript
interface CallAlert {
  id: string;
  phone_number: string;
  matched_session_id: string | null;
  matched_fingerprint?: string | null;
  lead_score: number;
  lead_score_at_match?: number | null;
  score_breakdown?: {...} | null;
  matched_at?: string | null;
  created_at: string;
  status?: string | null;
  source?: string | null; // click, api, manual
  confirmed_at?: string | null;
  confirmed_by?: string | null;
}
```

**Current Display** (lines 252-404):
- Phone number
- Lead score
- Status badges (INTENT, MATCH, CONFIRMED, etc.)
- Matching details (fingerprint, session ID, score breakdown)
- Actions (View Session, Confirm, Qualify, Junk)

**Missing**: Source/channel information

---

## B. Available Source Data (from Sessions)

### Session Fields (from `components/dashboard/session-group.tsx`)

**Lines 32-40**: Session data structure
```typescript
{
  attribution_source?: string | null;  // e.g., "First Click (Paid)", "Organic"
  device_type?: string | null;          // e.g., "Mobile", "Desktop"
  city?: string | null;                 // e.g., "Istanbul"
  district?: string | null;             // e.g., "Kadıköy"
  fingerprint?: string | null;
  gclid?: string | null;                 // Google Click ID
  site_id?: string | null;
}
```

**Event Metadata** (from events table):
- `metadata->>utm_campaign`
- `metadata->>utm_medium`
- `metadata->>utm_source`
- `metadata->>referrer` (or `url` for landing page)
- `metadata->>gclid`

---

## C. Channel Derivation Logic

### Definition: "Channel" = Attribution Source + UTM + Referrer Context

**Priority Order**:
1. **Paid Search** (Google Ads): `attribution_source` contains "Paid" AND `gclid` exists
2. **Organic Search**: `attribution_source` = "Organic" AND referrer contains search engine
3. **Social**: `utm_source` contains social platform OR referrer is social domain
4. **Direct**: `attribution_source` = "Direct" AND no UTM parameters
5. **Referral**: Referrer domain (not search engine, not social)
6. **Unknown**: Fallback

**Implementation**:
```typescript
function deriveChannel(session: SessionData, events: Event[]): {
  channel: string;
  campaign?: string;
  medium?: string;
  source?: string;
  landingUrl?: string;
  referrer?: string;
  gclid?: string;
} {
  const firstEvent = events[events.length - 1]; // Oldest event
  const metadata = firstEvent.metadata || {};
  
  const utmCampaign = metadata.utm_campaign || session.utm_campaign;
  const utmMedium = metadata.utm_medium || session.utm_medium;
  const utmSource = metadata.utm_source || session.utm_source;
  const referrer = metadata.referrer || firstEvent.url;
  const gclid = session.gclid || metadata.gclid;
  const attributionSource = session.attribution_source || metadata.attribution_source;
  
  // Determine channel
  let channel = 'Unknown';
  if (attributionSource?.includes('Paid') && gclid) {
    channel = 'Paid Search (Google Ads)';
  } else if (attributionSource === 'Organic') {
    channel = 'Organic Search';
  } else if (utmSource && ['facebook', 'instagram', 'twitter', 'linkedin'].some(s => utmSource.toLowerCase().includes(s))) {
    channel = 'Social';
  } else if (attributionSource === 'Direct') {
    channel = 'Direct';
  } else if (referrer && !referrer.includes('google') && !referrer.includes('bing')) {
    channel = 'Referral';
  }
  
  return {
    channel,
    campaign: utmCampaign,
    medium: utmMedium,
    source: utmSource,
    landingUrl: firstEvent.url,
    referrer: referrer,
    gclid: gclid
  };
}
```

---

## D. What Can Be Shown Immediately

### 1. Source Badge (Primary)

**Display**: Channel name with icon
- 🎯 Paid Search (Google Ads)
- 🔍 Organic Search
- 📱 Social
- 🏠 Direct
- 🔗 Referral
- ❓ Unknown

**Location**: Call Monitor card header (next to phone number)

---

### 2. UTM Parameters (Secondary)

**Display**: Campaign, Medium, Source chips
- Only show if UTM parameters exist
- Format: `Campaign: [name]`, `Medium: [medium]`, `Source: [source]`

**Location**: Expanded details section

---

### 3. Landing URL

**Display**: First event URL (landing page)
- Truncate if long
- Show full URL on hover

**Location**: Expanded details section

---

### 4. Referrer

**Display**: Referrer domain
- Extract domain from full referrer URL
- Show full URL on hover

**Location**: Expanded details section

---

### 5. GCLID Presence

**Display**: Badge if GCLID exists
- Indicates Google Ads click
- Show masked GCLID in expanded view

**Location**: Header badge + expanded details

---

### 6. Device & Location

**Display**: Device type, City, District
- Already available from session data
- Can be shown in expanded view

**Location**: Expanded details section

---

## E. Keyword Limitation

### Why Keywords Are Not Available

**Problem**: 
- Keywords are only available from Google Ads API
- Not stored in session/event metadata
- Requires Ads API integration and OAuth

**Current Data**:
- `gclid` exists → indicates Google Ads click
- But keyword is not captured in web tracking

**Solution (Future)**:
1. **Option A**: Google Ads API integration
   - Fetch keyword for GCLID
   - Store in `sessions` or `calls` table
   - Requires Ads API access and OAuth setup

2. **Option B**: UTM parameter workaround
   - Use `utm_term` parameter to pass keyword
   - Requires manual setup in Ads campaigns
   - Not reliable (depends on campaign configuration)

**Recommendation**: 
- Show "Keyword: N/A (requires Ads API)" for now
- Add Ads API integration in future sprint
- Document limitation in UI

---

## F. Implementation Plan

### Step 1: Fetch Session Data for Matched Calls

**File**: `components/dashboard/call-alert-wrapper.tsx`

**Change**: When fetching calls, also fetch matched session data

```typescript
// In CallAlertWrapper component
const [callSessions, setCallSessions] = useState<Map<string, SessionData>>(new Map());

// After fetching calls, fetch sessions
useEffect(() => {
  if (visibleCalls.length === 0) return;
  
  const sessionIds = visibleCalls
    .filter(c => c.matched_session_id)
    .map(c => c.matched_session_id!);
  
  if (sessionIds.length === 0) return;
  
  const supabase = createClient();
  supabase
    .from('sessions')
    .select('id, attribution_source, device_type, city, district, fingerprint, gclid, site_id')
    .in('id', sessionIds)
    .then(({ data }) => {
      const map = new Map();
      data?.forEach(s => map.set(s.id, s));
      setCallSessions(map);
    });
}, [visibleCalls]);
```

---

### Step 2: Fetch First Event for Landing URL

**File**: `components/dashboard/call-alert.tsx`

**Add**: Fetch first event for matched session to get landing URL and UTM params

```typescript
const [sessionData, setSessionData] = useState<SessionData | null>(null);
const [landingData, setLandingData] = useState<{
  url?: string;
  utm_campaign?: string;
  utm_medium?: string;
  utm_source?: string;
  referrer?: string;
} | null>(null);

useEffect(() => {
  if (!call.matched_session_id) return;
  
  const supabase = createClient();
  
  // Fetch session
  supabase
    .from('sessions')
    .select('attribution_source, device_type, city, district, fingerprint, gclid')
    .eq('id', call.matched_session_id)
    .single()
    .then(({ data }) => {
      if (data) setSessionData(data);
    });
  
  // Fetch first event (oldest) for landing URL
  supabase
    .from('events')
    .select('url, metadata, created_at')
    .eq('session_id', call.matched_session_id)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
    .single()
    .then(({ data }) => {
      if (data) {
        const meta = data.metadata || {};
        setLandingData({
          url: data.url,
          utm_campaign: meta.utm_campaign,
          utm_medium: meta.utm_medium,
          utm_source: meta.utm_source,
          referrer: meta.referrer
        });
      }
    });
}, [call.matched_session_id]);
```

---

### Step 3: Add Channel Derivation Utility

**File**: `lib/utils.ts`

**Add**: `deriveChannel` function (see Section C)

---

### Step 4: Update Call Alert UI

**File**: `components/dashboard/call-alert.tsx`

**Add to header** (after line 260):
```typescript
{channel && (
  <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
    channel.includes('Paid') ? 'bg-blue-500/20 text-blue-400' :
    channel.includes('Organic') ? 'bg-green-500/20 text-green-400' :
    channel.includes('Social') ? 'bg-purple-500/20 text-purple-400' :
    'bg-slate-700/50 text-slate-300'
  }`}>
    {channel}
  </span>
)}
```

**Add to expanded section** (after line 449):
```typescript
{/* Source & Channel Info */}
<div className="pt-2 border-t border-slate-800/30">
  <p className="font-mono text-xs text-slate-400 mb-2">SOURCE & CHANNEL</p>
  <div className="space-y-1 text-xs font-mono">
    {utmCampaign && (
      <div className="flex items-center justify-between">
        <span className="text-slate-500">Campaign:</span>
        <span className="text-slate-300">{utmCampaign}</span>
      </div>
    )}
    {utmMedium && (
      <div className="flex items-center justify-between">
        <span className="text-slate-500">Medium:</span>
        <span className="text-slate-300">{utmMedium}</span>
      </div>
    )}
    {utmSource && (
      <div className="flex items-center justify-between">
        <span className="text-slate-500">Source:</span>
        <span className="text-slate-300">{utmSource}</span>
      </div>
    )}
    {landingUrl && (
      <div className="flex items-center justify-between">
        <span className="text-slate-500">Landing URL:</span>
        <span className="text-slate-300 text-[10px] truncate max-w-xs" title={landingUrl}>
          {landingUrl}
        </span>
      </div>
    )}
    {referrer && (
      <div className="flex items-center justify-between">
        <span className="text-slate-500">Referrer:</span>
        <span className="text-slate-300 text-[10px] truncate max-w-xs" title={referrer}>
          {new URL(referrer).hostname}
        </span>
      </div>
    )}
    {gclid && (
      <div className="flex items-center justify-between">
        <span className="text-slate-500">GCLID:</span>
        <span className="text-slate-300 text-[10px]">{gclid.slice(0, 12)}...</span>
      </div>
    )}
    <div className="flex items-center justify-between pt-1 border-t border-slate-800/30">
      <span className="text-slate-500">Keyword:</span>
      <span className="text-slate-400 italic text-[10px]">N/A (requires Ads API)</span>
    </div>
  </div>
</div>
```

---

## G. Files to Modify

1. `lib/utils.ts` - Add `deriveChannel` function
2. `components/dashboard/call-alert.tsx` - Add session/event fetching and UI
3. `components/dashboard/call-alert-wrapper.tsx` - Optional: batch session fetching

---

## H. Future Enhancements (Ads API Integration)

1. **Google Ads API OAuth Setup**
   - Store OAuth tokens securely
   - Refresh tokens automatically

2. **Keyword Fetching**
   - Query Ads API with GCLID
   - Store keyword in `sessions` or `calls` table
   - Cache results to avoid API rate limits

3. **Additional Ads Data**
   - Ad group name
   - Ad ID
   - Campaign name (from Ads, not UTM)

---

**Next Steps**: Implement Step 1-4, test with real call data, verify channel derivation logic.
