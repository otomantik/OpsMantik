type TenantMap = Record<string, string>;
type SecretMap = Record<string, string>;

interface WorkerEnv {
	OPSMANTIK_BASE_URL?: string;
	SITE_CONFIG?: string;
	OPS_CALL_EVENT_SECRETS?: string;
}

type LegacyMetricsPayload = {
	event?: string;
	label?: string;
	value?: number | string | null;
	url?: string;
	session_id?: string;
	fingerprint?: string;
	gclid?: string;
	wbraid?: string;
	gbraid?: string;
	meta?: Record<string, unknown>;
};

type CallEventPayload = {
	site_id?: string;
	fingerprint?: string;
	intent_action?: string;
	action?: string;
	intent_target?: string;
	phone_number?: string;
	intent_page_url?: string;
	url?: string;
	gclid?: string;
	wbraid?: string;
	gbraid?: string;
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

function buildCorsHeaders(origin: string | null): HeadersInit {
	return {
		"access-control-allow-origin": origin ?? "*",
		"access-control-allow-methods": "POST,OPTIONS",
		"access-control-allow-headers": "content-type,x-ops-site-id,x-ops-ts,x-ops-signature",
		vary: "origin",
	};
}

function normalizeHost(value: string): string {
	return value.trim().toLowerCase().replace(/^www\./, "");
}

function parseJsonMap(raw: string | undefined): Record<string, string> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(parsed)) {
			if (typeof v === "string" && v.trim().length > 0) out[normalizeHost(k)] = v.trim();
		}
		return out;
	} catch {
		return {};
	}
}

function toObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

type EdgeCfContext = {
	city?: string;
	region?: string;
	country?: string;
	timezone?: string;
};

function injectEdgeGeo(meta: Record<string, unknown>, request: Request): Record<string, unknown> {
	const cf = (request as Request & { cf?: EdgeCfContext }).cf;
	const next = { ...meta };
	if (cf?.city && !next.city) next.city = cf.city;
	if (cf?.region && !next.region) next.region = cf.region;
	if (cf?.country && !next.country) next.country = cf.country;
	if (cf?.timezone && !next.timezone) next.timezone = cf.timezone;
	return next;
}

function applySiteAndGeoToSyncPayload(payload: unknown, siteId: string, request: Request): unknown {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
	const obj = payload as Record<string, unknown>;

	if (Array.isArray(obj.events)) {
		const events = obj.events.map((event) => {
			const e = toObject(event);
			const withSite = typeof e.s === "string" && e.s.trim().length > 0 ? e : { ...e, s: siteId };
			const meta = injectEdgeGeo(toObject(withSite.meta), request);
			return { ...withSite, meta };
		});
		return { ...obj, events };
	}

	const withSite = typeof obj.s === "string" && obj.s.trim().length > 0 ? obj : { ...obj, s: siteId };
	const meta = injectEdgeGeo(toObject(withSite.meta), request);
	return { ...withSite, meta };
}

function buildSyncFromLegacyMetrics(payload: LegacyMetricsPayload, siteId: string, request: Request): Record<string, unknown> {
	const action = typeof payload.event === "string" && payload.event.trim().length > 0 ? payload.event.trim() : "custom_event";
	const label = typeof payload.label === "string" ? payload.label : null;
	const url = typeof payload.url === "string" && payload.url.length > 0 ? payload.url : request.url;
	const value = payload.value ?? null;
	return {
		s: siteId,
		u: url,
		sid: payload.session_id ?? crypto.randomUUID(),
		ec: "interaction",
		ea: action,
		el: label,
		ev: value,
		meta: injectEdgeGeo(
			{
				fp: payload.fingerprint ?? null,
				gclid: payload.gclid ?? null,
				wbraid: payload.wbraid ?? null,
				gbraid: payload.gbraid ?? null,
				...(toObject(payload.meta)),
			},
			request
		),
		consent_scopes: ["marketing"],
	};
}

function buildSyncFromCallEvent(payload: CallEventPayload, siteId: string, request: Request): Record<string, unknown> {
	const actionRaw =
		typeof payload.intent_action === "string" && payload.intent_action.trim().length > 0
			? payload.intent_action.trim().toLowerCase()
			: typeof payload.action === "string" && payload.action.trim().length > 0
				? payload.action.trim().toLowerCase()
				: "call_event";
	const labelRaw =
		typeof payload.intent_target === "string" && payload.intent_target.trim().length > 0
			? payload.intent_target.trim()
			: typeof payload.phone_number === "string" && payload.phone_number.trim().length > 0
				? payload.phone_number.trim()
				: "unknown_target";
	const pageUrl =
		typeof payload.intent_page_url === "string" && payload.intent_page_url.trim().length > 0
			? payload.intent_page_url.trim()
			: typeof payload.url === "string" && payload.url.trim().length > 0
				? payload.url.trim()
				: request.url;
	return {
		s: siteId,
		u: pageUrl,
		sid: crypto.randomUUID(),
		ec: "conversion",
		ea: actionRaw,
		el: labelRaw,
		meta: injectEdgeGeo(
			{
				proxy_source: "call-event-fallback",
				fp: typeof payload.fingerprint === "string" ? payload.fingerprint : null,
				intent_action: actionRaw,
				intent_target: labelRaw,
				gclid: typeof payload.gclid === "string" ? payload.gclid : null,
				wbraid: typeof payload.wbraid === "string" ? payload.wbraid : null,
				gbraid: typeof payload.gbraid === "string" ? payload.gbraid : null,
			},
			request
		),
		consent_scopes: ["marketing"],
	};
}

async function hmacHex(secret: string, message: string): Promise<string> {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
	return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function forwardJson(
	url: string,
	request: Request,
	payload: unknown,
	extraHeaders: Record<string, string> = {}
): Promise<Response> {
	const upstream = await fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...extraHeaders,
		},
		body: JSON.stringify(payload),
	});
	const text = await upstream.text();
	return new Response(text, {
		status: upstream.status,
		headers: {
			"content-type": upstream.headers.get("content-type") ?? "application/json",
			...buildCorsHeaders(request.headers.get("origin")),
		},
	});
}

function resolveTenantSiteId(request: Request, tenantMap: TenantMap): string | null {
	const url = new URL(request.url);
	const host = normalizeHost(url.hostname);
	return tenantMap[host] ?? null;
}

export default {
	async fetch(request: Request, env: WorkerEnv): Promise<Response> {
		const origin = request.headers.get("origin");
		const url = new URL(request.url);
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 200, headers: buildCorsHeaders(origin) });
		}

		const tenantMap = parseJsonMap(env.SITE_CONFIG);
		const secretMap = parseJsonMap(env.OPS_CALL_EVENT_SECRETS);
		const siteId = resolveTenantSiteId(request, tenantMap);
		if (!siteId) {
			console.log("[adsmantik-engine] unresolved tenant", { host: url.hostname, path: url.pathname });
			return jsonResponse({ error: "unresolved_site" }, 401);
		}

		const base = (env.OPSMANTIK_BASE_URL || "https://console.opsmantik.com").replace(/\/+$/, "");

		try {
			if (url.pathname === "/opsmantik/sync" && request.method === "POST") {
				const incoming = await request.json().catch(() => null);
				if (!incoming) return jsonResponse({ error: "invalid_json" }, 400);
				const payload = applySiteAndGeoToSyncPayload(incoming, siteId, request);
				return await forwardJson(`${base}/api/sync`, request, payload);
			}

			if (url.pathname === "/metrics/track" && request.method === "POST") {
				const incoming = (await request.json().catch(() => null)) as LegacyMetricsPayload | null;
				if (!incoming) return jsonResponse({ error: "invalid_json" }, 400);
				const payload = buildSyncFromLegacyMetrics(incoming, siteId, request);
				return await forwardJson(`${base}/api/sync`, request, payload);
			}

			if (url.pathname === "/opsmantik/call-event" && request.method === "POST") {
				const rawBody = await request.text();
				if (!rawBody) return jsonResponse({ error: "empty_body" }, 400);
				let body: Record<string, unknown>;
				try {
					body = JSON.parse(rawBody) as Record<string, unknown>;
				} catch {
					return jsonResponse({ error: "invalid_json" }, 400);
				}

				const payload = {
					...body,
					site_id: typeof body.site_id === "string" && body.site_id.trim().length > 0 ? body.site_id : siteId,
				};
				const secret = secretMap[siteId];
				if (!secret) {
					console.log("[adsmantik-engine] missing call-event secret", { siteId });
					return jsonResponse({ error: "missing_secret" }, 401);
				}

				const ts = String(Math.floor(Date.now() / 1000));
				const toSign = `${ts}.${JSON.stringify(payload)}`;
				const signature = await hmacHex(secret, toSign);
				const signedResponse = await forwardJson(`${base}/api/call-event/v2`, request, payload, {
					"x-ops-site-id": siteId,
					"x-ops-ts": ts,
					"x-ops-signature": signature,
				});
				if (signedResponse.status !== 401) {
					return signedResponse;
				}

				// Emergency fallback: if signing mismatches backend secret, downgrade to canonical sync signal
				// so intent tracking stays live until secret rotation is aligned.
				console.log("[adsmantik-engine] call-event signature mismatch, using sync fallback", { siteId });
				const syncFallbackPayload = buildSyncFromCallEvent(payload, siteId, request);
				return await forwardJson(`${base}/api/sync`, request, syncFallbackPayload);
			}

			return new Response("Not found", { status: 404, headers: buildCorsHeaders(origin) });
		} catch (error) {
			console.log("[adsmantik-engine] unhandled error", String(error));
			return jsonResponse({ error: "internal_error" }, 500);
		}
	},
} satisfies ExportedHandler<WorkerEnv>;
