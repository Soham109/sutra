// Discovery: how another agent finds, reads and trusts this engine.
//
//   endpoints.ts   the single inventory of what this engine actually serves
//   agent-card.ts  A2A AgentCard (+ the GMP/1 capability extension)
//   agent-facts.ts NANDA AgentFacts (+ a proposed, namespaced x-payments block)
//   catalog.ts     the AI Catalog at /api/agents, and the NANDA Index record
//   routes.ts      registerDiscoveryRoutes(app, cfg)

export * from './endpoints.js'
export * from './agent-card.js'
export * from './agent-facts.js'
export * from './catalog.js'
export * from './routes.js'
