// Read, never provided: the cache-tax mod adds $.cacheTax. Where it is not installed the call throws, and the band catches that.
declare module 'claude-code' {
  interface EngineInterface {
    cacheTax: { status: () => Promise<{ keepwarm: 'on' | 'off' | 'stopped'; leftMs: number }> }
  }
}
