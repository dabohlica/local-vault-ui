import { describe, it, expect } from 'vitest'
import { isAllowedHost, isSameOriginRequest, hostnameOf } from '@/lib/access'

describe('isAllowedHost (DNS-rebinding guard)', () => {
  it('allows loopback, IP literals and MagicDNS names', () => {
    for (const h of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', '100.101.102.103:3000', 'mac.tail1234.ts.net', '192.168.1.20:3000']) {
      expect(isAllowedHost(h), h).toBe(true)
    }
  })
  it('rejects arbitrary domain names (the rebinding vector)', () => {
    expect(isAllowedHost('evil.example.com')).toBe(false)
    expect(isAllowedHost('localhost.evil.com')).toBe(false)
    expect(isAllowedHost('ts.net.evil.com')).toBe(false)
    expect(isAllowedHost(null)).toBe(false)
  })
  it('honours VAULT_ALLOWED_HOSTS extras', () => {
    expect(isAllowedHost('macbook.local:3000', ['macbook.local'])).toBe(true)
  })
  it('parses hostnames', () => {
    expect(hostnameOf('[fd7a:115c::1]:3000')).toBe('fd7a:115c::1')
    expect(hostnameOf('Example.COM:80')).toBe('example.com')
  })
})

describe('isSameOriginRequest (CSRF guard)', () => {
  it('lets reads and non-browser clients through', () => {
    expect(isSameOriginRequest('GET', 'https://evil.com', 'localhost:3000')).toBe(true)
    expect(isSameOriginRequest('POST', null, 'localhost:3000')).toBe(true)
  })
  it('allows same-origin writes', () => {
    expect(isSameOriginRequest('POST', 'http://localhost:3000', 'localhost:3000')).toBe(true)
    expect(isSameOriginRequest('POST', 'https://mac.tail1.ts.net', '127.0.0.1:3000', 'mac.tail1.ts.net')).toBe(true)
  })
  it('blocks cross-site writes', () => {
    expect(isSameOriginRequest('POST', 'https://evil.com', 'localhost:3000')).toBe(false)
    expect(isSameOriginRequest('DELETE', 'http://localhost:3001', 'localhost:3000')).toBe(false)
    expect(isSameOriginRequest('POST', 'null', 'localhost:3000')).toBe(false)
  })
})
