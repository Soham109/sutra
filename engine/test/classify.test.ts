import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyCategory } from '../src/agent/classify.js'

const originalKey = process.env.OPENAI_API_KEY
const originalModel = process.env.OPENAI_MODEL

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = originalKey
  if (originalModel === undefined) delete process.env.OPENAI_MODEL
  else process.env.OPENAI_MODEL = originalModel
})

describe('optional category classifier', () => {
  it('stays completely offline when no key is configured', async () => {
    delete process.env.OPENAI_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(classifyCategory('quiet place after the no-key test')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts only a category from the constrained tool result', async () => {
    process.env.OPENAI_API_KEY = 'test-only-key'
    delete process.env.OPENAI_MODEL
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { tool_calls: [{ function: { arguments: '{"category":"cafe"}' } }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(classifyCategory('tea and revision classifier test')).resolves.toBe('cafe')
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(init.body)) as {
      model: string
      tools: { function: { parameters: { properties: { category: { enum: string[] } } } } }[]
    }
    expect(body.model).toBe('gpt-4.1-nano')
    expect(body.tools[0]?.function.parameters.properties.category.enum).toContain('cafe')
    expect(body.tools[0]?.function.parameters.properties.category.enum).toContain('none')
  })

  it('does not cache a temporary provider failure', async () => {
    process.env.OPENAI_API_KEY = 'test-only-key'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { tool_calls: [{ function: { arguments: '{"category":"cinema"}' } }] } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const query = 'big screen retry classifier test'
    await expect(classifyCategory(query)).resolves.toBeNull()
    await expect(classifyCategory(query)).resolves.toBe('cinema')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
