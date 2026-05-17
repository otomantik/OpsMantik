import { NextResponse } from 'next/server';

/** True when running a production deployment (Node, Vercel, or OCI env marker). */
export function isProductionDeployment(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.OCI_ENV === 'production'
  );
}

/** Fail-closed 404 for dev/debug routes in production — no route detail in body. */
export function productionDeploymentNotFoundResponse(): NextResponse {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

/** Returns a 404 response in production; otherwise null (caller continues). */
export function assertNotProductionDeployment(): NextResponse | null {
  if (isProductionDeployment()) {
    return productionDeploymentNotFoundResponse();
  }
  return null;
}
