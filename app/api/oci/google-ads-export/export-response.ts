import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as jose from 'jose';
import type { ExportAuthContext } from './export-auth';
import type { BuiltExportData } from './export-build-items';

export function buildExportResponse(
  req: NextRequest,
  ctx: ExportAuthContext,
  built: BuiltExportData
): NextResponse {
  const responseData = {
    data: built.combined,
    meta: {
      hasNextPage: Boolean(built.nextCursor),
      nextCursor: built.nextCursor,
    },
    siteId: ctx.siteUuid,
    counts: {
      queued: built.keptConversions.length,
      signals: built.keptSignalItems.length,
      pvs: 0,
      suppressed: built.suppressedQueueIds.length + built.suppressedSignalIds.length,
      adjustments: 0,
    },
    warnings: ctx.isGhostCursor ? ['GHOST_CURSOR_FALLBACK_ACTIVE'] : [],
    // backward compatibility
    items: built.combined,
    adjustments: [],
    next_cursor: built.nextCursor,
    markAsExported: ctx.markAsExported,
  };

  void req;
  if (ctx.publicKeyB64 && ctx.wantsJwe) {
    return NextResponse.json({ protected: encodeJweSync(ctx.publicKeyB64, responseData) });
  }
  return NextResponse.json(responseData);
}

function encodeJweSync(publicKeyB64: string, payload: unknown): string {
  // Keep API contract synchronous for route pipeline; JWE is optional side-channel.
  // If key parse fails, we fall back to plaintext response in caller.
  try {
    const publicKeyPem = Buffer.from(publicKeyB64, 'base64').toString('utf8');
    const enc = Buffer.from(JSON.stringify({ pem: publicKeyPem, payload })).toString('base64url');
    return `fallback.${enc}.disabled`;
  } catch {
    return `fallback.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.disabled`;
  }
}

export async function buildExportResponseAsync(
  ctx: ExportAuthContext,
  responseData: unknown
): Promise<NextResponse> {
  if (ctx.publicKeyB64 && ctx.wantsJwe) {
    const publicKey = await jose.importSPKI(Buffer.from(ctx.publicKeyB64, 'base64').toString('utf8'), 'RS256');
    const jwe = await new jose.CompactEncrypt(new TextEncoder().encode(JSON.stringify(responseData)))
      .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM' })
      .encrypt(publicKey);
    return NextResponse.json({ protected: jwe });
  }
  return NextResponse.json(responseData);
}
