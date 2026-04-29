type TenantMap = Record<string, string>;

interface WorkerEnv {
	OPSMANTIK_BASE_URL?: string;
	SITE_CONFIG?: string;
	SITE_CONFIG_URL?: string;
	SITE_CONFIG_TTL_MS?: string;
	WORKER_TENANT_MAP_TOKEN?: string;
	OPS_CALL_EVENT_SECRETS?: string;
}

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

let tenantMapCache: { expiresAt: number; data: TenantMap } | null = null;

async function loadTenantMap(env: WorkerEnv): Promise<TenantMap> {
	const now = Date.now();
	if (tenantMapCache && tenantMapCache.expiresAt > now) {
		return tenantMapCache.data;
	}

	const staticMap = parseJsonMap(env.SITE_CONFIG);
	const mergedMap: TenantMap = { ...staticMap };
	const mapUrl = env.SITE_CONFIG_URL?.trim();
	if (mapUrl) {
		try {
			const res = await fetch(mapUrl, {
				headers: env.WORKER_TENANT_MAP_TOKEN
					? { "x-ops-worker-token": env.WORKER_TENANT_MAP_TOKEN }
					: {},
			});
			if (res.ok) {
				const parsed = (await res.json()) as { map?: Record<string, unknown> };
				const remoteMapRaw =
					parsed && typeof parsed === "object" && parsed.map && typeof parsed.map === "object"
						? parsed.map
						: {};
				for (const [host, value] of Object.entries(remoteMapRaw)) {
					if (typeof value === "string" && value.trim().length > 0) {
						mergedMap[normalizeHost(host)] = value.trim();
					}
				}
			}
		} catch (error) {
			console.log("[adsmantik-engine] tenant map fetch failed", String(error));
		}
	}

	const ttl = Number(env.SITE_CONFIG_TTL_MS || 300000);
	tenantMapCache = { expiresAt: now + (Number.isFinite(ttl) ? Math.max(10000, ttl) : 300000), data: mergedMap };
	return mergedMap;
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

function normalizeSyncPayload(incoming: unknown, siteId: string, request: Request): Record<string, unknown> {
	if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
		return { s: siteId, events: [], consent_scopes: ["analytics"] };
	}
	const obj = incoming as Record<string, unknown>;
	const consentScopes = Array.isArray(obj.consent_scopes) ? obj.consent_scopes : ["analytics", "marketing"];

	// 1. Resolve events array
	let eventsRaw: unknown[] = [];
	if (Array.isArray(obj.events)) {
		eventsRaw = obj.events;
	} else if (Array.isArray(obj.batch)) {
		eventsRaw = obj.batch;
	} else if (typeof obj.event === "string" || typeof obj.ea === "string" || typeof obj.intent_action === "string") {
		// Single event or legacy metrics/call-event format
		eventsRaw = [obj];
	} else {
		// Aggressive fallback: treat any object as a single event to avoid 422 empty array
		eventsRaw = [obj];
	}

	// 2. Map and normalize each event
	const events = eventsRaw.map((event) => {
		const e = toObject(event);
		// Ensure event level s
		const s = typeof e.s === "string" && e.s.trim().length > 0 ? e.s.trim() : siteId;

		// Map legacy fields if present
		const action = (e.ea || e.event || e.intent_action || "custom_event") as string;
		const category = (e.ec || (e.intent_action ? "conversion" : "interaction")) as string;
		const label = (e.el || e.label || e.intent_target || e.phone_number || null) as string | null;
		const url = (e.u || e.url || e.intent_page_url || request.url) as string;
		const value = (e.ev ?? e.value ?? null) as number | string | null;
		const sid = (e.sid || e.session_id || crypto.randomUUID()) as string;

		const res: Record<string, unknown> = {
			s,
			u: url,
			sid,
			ec: category,
			ea: action,
			consent_scopes: consentScopes, // BURASI KRİTİK!
			meta: injectEdgeGeo(
				{
					...(toObject(e.meta)),
					fp: e.fp || e.fingerprint || null,
					gclid: e.gclid || null,
					wbraid: e.wbraid || null,
					gbraid: e.gbraid || null,
				},
				request
			),
		};

		if (label) res.el = label;
		if (value !== null) res.ev = value;

		return res;
	});

	return {
		s: siteId,
		events,
		consent_scopes: consentScopes,
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
	const origin = request.headers.get("origin");
	try {
		const upstream = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-ops-proxy-worker": "adsmantik-engine",
				...extraHeaders,
			},
			body: JSON.stringify(payload),
		});
		const text = await upstream.text();
		return new Response(text, {
			status: upstream.status,
			headers: {
				"content-type": upstream.headers.get("content-type") ?? "application/json",
				...buildCorsHeaders(origin),
			},
		});
	} catch (error) {
		console.log("[adsmantik-engine] forward failed", url, String(error));
		return jsonResponse({ error: "upstream_error", message: String(error) }, 502);
	}
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

		const tenantMap = await loadTenantMap(env);
		const secretMap = parseJsonMap(env.OPS_CALL_EVENT_SECRETS);
		const siteId = resolveTenantSiteId(request, tenantMap);
		if (!siteId) {
			console.log("[adsmantik-engine] unresolved tenant", { host: url.hostname, path: url.pathname });
			return jsonResponse({ error: "unresolved_site" }, 401);
		}

		const base = (env.OPSMANTIK_BASE_URL || "https://console.opsmantik.com").replace(/\/+$/, "");

		try {
			if (url.pathname === "/opsmantik/core.js") {
				const assetUrl = "https://assets.opsmantik.com/assets/core.js";
				const assetRes = await fetch(assetUrl);
				return new Response(assetRes.body, {
					status: assetRes.status,
					headers: {
						"content-type": "application/javascript; charset=utf-8",
						"cache-control": "public, max-age=3600",
						...buildCorsHeaders(origin),
					},
				});
			}

			if (url.pathname === "/opsmantik/sync" && request.method === "POST") {
				const incoming = await request.json().catch(() => null);
				if (!incoming) return jsonResponse({ error: "invalid_json" }, 400);
				const payload = normalizeSyncPayload(incoming, siteId, request);
				return await forwardJson(`${base}/api/sync`, request, payload);
			}

			if (url.pathname === "/metrics/track" && request.method === "POST") {
				const incoming = await request.json().catch(() => null);
				if (!incoming) return jsonResponse({ error: "invalid_json" }, 400);
				const payload = normalizeSyncPayload(incoming, siteId, request);
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
					console.log("[adsmantik-engine] missing call-event secret, using sync fallback", { siteId });
					const syncFallbackPayload = normalizeSyncPayload(payload, siteId, request);
					return await forwardJson(`${base}/api/sync`, request, syncFallbackPayload);
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

				// Emergency fallback: normalize and send to sync
				console.log("[adsmantik-engine] call-event signature mismatch, using sync fallback", { siteId });
				const syncFallbackPayload = normalizeSyncPayload(payload, siteId, request);
				return await forwardJson(`${base}/api/sync`, request, syncFallbackPayload);
			}

			return new Response("Not found", { status: 404, headers: buildCorsHeaders(origin) });
		} catch (error) {
			console.log("[adsmantik-engine] unhandled error", String(error));
			return jsonResponse({ error: "internal_error" }, 500);
		}
	},
} satisfies ExportedHandler<WorkerEnv>;
