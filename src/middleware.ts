import { NextRequest, NextResponse } from 'next/server'
import { isAllowedHost, isSameOriginRequest } from '@/lib/access'

const EXTRA_HOSTS = (process.env.VAULT_ALLOWED_HOSTS ?? '').split(',').filter(Boolean)

// Guards every route (pages too — a rebinding attacker could otherwise load the
// app's own pages under their domain). See src/lib/access.ts for the rationale.
export function middleware(req: NextRequest) {
  const host = req.headers.get('host')
  if (!isAllowedHost(host, EXTRA_HOSTS)) {
    return new NextResponse(
      `Host "${host}" is not allowed. Add it to VAULT_ALLOWED_HOSTS if this is your own machine.`,
      { status: 403 },
    )
  }
  if (!isSameOriginRequest(req.method, req.headers.get('origin'), host, req.headers.get('x-forwarded-host'))) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
