import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
    let response = NextResponse.next({
        request: {
            headers: request.headers,
        },
    })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const allowMissingEnv = process.env.CI === 'true' || process.env.NEXT_PHASE === 'phase-production-build'

    // In CI/build, Supabase secrets may be intentionally missing.
    // Do not crash the middleware (would break /api/health and CI e2e workflow).
    // In runtime, we still want a loud failure if auth is misconfigured.
    if (!supabaseUrl || !anonKey) {
        if (allowMissingEnv) {
            return response
        }
        throw new Error(
            'Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set'
        )
    }

    // Retain existing headers (like x-request-id from the main middleware)
    // The main middleware passes the request, and we build response on top of it.

    const supabase = createServerClient(
        supabaseUrl,
        anonKey,
        {
            cookieOptions: {
                sameSite: 'lax',
                secure: true,
            },
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
                    cookiesToSet.forEach(({ name, value }) => {
                        request.cookies.set(name, value)
                    })
                    response = NextResponse.next({
                        request: {
                            headers: request.headers,
                        },
                    })
                    // Copy over the headers from the original response (e.g. x-request-id) 
                    // Note: In Next.js middleware, mutating response headers after creating it is a bit tricky
                    // but we will handle x-request-id in the main middleware wrapper.

                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // Refresh session if expired - required for Server Components
    // https://supabase.com/docs/guides/auth/server-side/nextjs
    const { data: { user } } = await supabase.auth.getUser()

    // Protected Routes Logic
    const path = request.nextUrl.pathname

    // Dashboard protection
    if (path.startsWith('/dashboard') && !user) {
        return NextResponse.redirect(new URL('/login', request.url))
    }

    // Admin protection: require both logged-in AND profile.role = 'admin' (is_admin). Non-admins get 403.
    if (path.startsWith('/admin')) {
        if (!user) {
            return NextResponse.redirect(new URL('/login', request.url))
        }
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()
        if (profile?.role !== 'admin') {
            return NextResponse.redirect(new URL('/dashboard', request.url))
        }
    }

    // Redirect to dashboard if logged in and trying to access login
    if (path === ('/login') && user) {
        return NextResponse.redirect(new URL('/dashboard', request.url))
    }

    if (path === '/' && user) {
        return NextResponse.redirect(new URL('/dashboard', request.url))
    }

    return response
}
