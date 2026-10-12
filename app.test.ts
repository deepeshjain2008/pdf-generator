jest.mock('puppeteer', () => ({
  launch: jest.fn()
}))
jest.mock('axios', () => ({
  get: jest.fn()
}))

import request from 'supertest'
import puppeteer from 'puppeteer'
import axios from 'axios'
import {
  app,
  browserPool,
  waitQueue,
  createBrowserEntry,
  initBrowserPool,
  recycleIdleBrowsers,
  acquirePage,
  releasePage,
  acquireRenderSlot,
  releaseRenderSlot,
  shutdown,
  BROWSER_POOL_SIZE,
  MAX_PAGES_PER_BROWSER,
  MAX_CONCURRENT_RENDERS,
  MAX_PAGES_BEFORE_RECYCLE,
  QUEUE_TIMEOUT
} from './app'

const mockedPuppeteer = puppeteer as unknown as { launch: jest.Mock }
const mockedAxios = axios as unknown as { get: jest.Mock }

function makeFakePage() {
  return {
    goto: jest.fn().mockResolvedValue(undefined),
    setViewport: jest.fn().mockResolvedValue(undefined),
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    $: jest.fn().mockResolvedValue({
      screenshot: jest.fn().mockResolvedValue(Buffer.from('fake-png'))
    }),
    pdf: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
    close: jest.fn().mockResolvedValue(undefined)
  }
}

function makeFakeBrowser() {
  const handlers: Record<string, Array<() => void>> = {}
  return {
    newPage: jest.fn().mockResolvedValue(makeFakePage()),
    close: jest.fn().mockResolvedValue(undefined),
    on: jest.fn((event: string, cb: () => void) => {
      handlers[event] = handlers[event] || []
      handlers[event].push(cb)
    }),
    __emit: (event: string) => {
      (handlers[event] || []).forEach((cb) => cb())
    }
  }
}

function drainPool() {
  browserPool.length = 0
  waitQueue.length = 0
}

async function fillRenderSlots(count: number) {
  for (let i = 0; i < count; i++) {
    await acquireRenderSlot()
  }
}

function releaseRenderSlots(count: number) {
  for (let i = 0; i < count; i++) {
    releaseRenderSlot()
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockedPuppeteer.launch.mockImplementation(async () => makeFakeBrowser())
  drainPool()
})

describe('basic routes', () => {
  test('GET / returns Hello World', async () => {
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.text).toBe('Hello World!')
  })

  test('GET /liveness returns ok', async () => {
    const res = await request(app).get('/liveness')
    expect(res.status).toBe(200)
    expect(res.text).toBe('ok')
  })

  test('x-powered-by header is disabled', async () => {
    const res = await request(app).get('/')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})

describe('GET /readiness', () => {
  test('returns 200 when capacity is available', async () => {
    const res = await request(app).get('/readiness')
    expect(res.status).toBe(200)
    expect(res.text).toBe('ok')
  })

  test('returns 503 when all render slots are busy', async () => {
    await fillRenderSlots(MAX_CONCURRENT_RENDERS)
    const res = await request(app).get('/readiness')
    expect(res.status).toBe(503)
    expect(res.text).toBe('Service busy')
    releaseRenderSlots(MAX_CONCURRENT_RENDERS)
  })
})

describe('createBrowserEntry', () => {
  test('launches puppeteer with the expected hardening flags', async () => {
    const entry = await createBrowserEntry()
    expect(mockedPuppeteer.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: true,
        args: expect.arrayContaining(['--no-sandbox', '--disable-setuid-sandbox'])
      })
    )
    expect(entry.activePages).toBe(0)
    expect(entry.totalPagesServed).toBe(0)
  })

  test('removes the entry from the pool when the browser disconnects', async () => {
    const entry = await createBrowserEntry() as any
    browserPool.push(entry)
    expect(browserPool).toContain(entry)
    entry.browser.__emit('disconnected')
    expect(browserPool).not.toContain(entry)
  })

  test('disconnect handler is a no-op when the entry is no longer in the pool', async () => {
    const entry = await createBrowserEntry() as any
    expect(() => entry.browser.__emit('disconnected')).not.toThrow()
  })
})

describe('initBrowserPool', () => {
  test('launches BROWSER_POOL_SIZE browsers', async () => {
    await initBrowserPool()
    expect(browserPool.length).toBe(BROWSER_POOL_SIZE)
    expect(mockedPuppeteer.launch).toHaveBeenCalledTimes(BROWSER_POOL_SIZE)
  })
})

describe('acquirePage / releasePage', () => {
  test('replenishes the pool on demand and hands out a page', async () => {
    const { page, entry } = await acquirePage()
    expect(page).toBeDefined()
    expect(entry.activePages).toBe(1)
    expect(entry.totalPagesServed).toBe(1)
    expect(browserPool.length).toBe(BROWSER_POOL_SIZE)
  })

  test('picks the least busy browser in the pool', async () => {
    await initBrowserPool()
    browserPool[0].activePages = 5
    const { entry } = await acquirePage()
    expect(entry).not.toBe(browserPool[0])
  })

  test('throws when every browser in the pool is already full', async () => {
    for (let i = 0; i < BROWSER_POOL_SIZE; i++) {
      browserPool.push({ browser: makeFakeBrowser(), activePages: MAX_PAGES_PER_BROWSER, totalPagesServed: 0 })
    }
    await expect(acquirePage()).rejects.toThrow('All browser slots full')
  })

  test('rejects if the pool cannot be replenished and is empty', async () => {
    mockedPuppeteer.launch.mockRejectedValue(new Error('launch failed'))
    await expect(acquirePage()).rejects.toThrow()
  })

  test('releasePage closes the page and decrements activePages', async () => {
    const { page, entry } = await acquirePage()
    await releasePage(page, entry)
    expect(page.close).toHaveBeenCalled()
    expect(entry.activePages).toBe(0)
  })

  test('releasePage recycles the browser once its page threshold is reached', async () => {
    const { page, entry } = await acquirePage()
    entry.totalPagesServed = MAX_PAGES_BEFORE_RECYCLE
    await releasePage(page, entry)
    expect(entry.browser.close).toHaveBeenCalled()
    expect(browserPool).not.toContain(entry)
    expect(browserPool.length).toBe(BROWSER_POOL_SIZE)
  })

  test('releasePage tolerates a missing page', async () => {
    const entry = { browser: makeFakeBrowser(), activePages: 1, totalPagesServed: 1 }
    await expect(releasePage(null as any, entry)).resolves.toBeUndefined()
    expect(entry.activePages).toBe(0)
  })
})

describe('recycleIdleBrowsers', () => {
  test('recycles idle browsers past the page threshold and replaces them', async () => {
    const stale = { browser: makeFakeBrowser(), activePages: 0, totalPagesServed: MAX_PAGES_BEFORE_RECYCLE }
    const fresh = { browser: makeFakeBrowser(), activePages: 0, totalPagesServed: 1 }
    const busy = { browser: makeFakeBrowser(), activePages: 2, totalPagesServed: MAX_PAGES_BEFORE_RECYCLE }
    browserPool.push(stale, fresh, busy)

    await recycleIdleBrowsers()

    expect(stale.browser.close).toHaveBeenCalled()
    expect(browserPool).not.toContain(stale)
    expect(browserPool).toContain(fresh)
    expect(browserPool).toContain(busy)
    expect(browserPool.length).toBe(3)
  })

  test('leaves the pool short-handed if the replacement browser fails to launch', async () => {
    const stale = { browser: makeFakeBrowser(), activePages: 0, totalPagesServed: MAX_PAGES_BEFORE_RECYCLE }
    browserPool.push(stale)
    mockedPuppeteer.launch.mockRejectedValueOnce(new Error('launch failed'))

    await recycleIdleBrowsers()

    expect(browserPool).not.toContain(stale)
    expect(browserPool.length).toBe(0)
  })
})

describe('acquireRenderSlot / releaseRenderSlot', () => {
  test('resolves immediately while under the concurrency limit', async () => {
    await expect(acquireRenderSlot()).resolves.toBeUndefined()
    releaseRenderSlot()
  })

  test('queues callers once the limit is reached and serves them on release', async () => {
    await fillRenderSlots(MAX_CONCURRENT_RENDERS)
    const queued = acquireRenderSlot()
    expect(waitQueue.length).toBe(1)
    releaseRenderSlot()
    await expect(queued).resolves.toBeUndefined()
    // The dequeue above handed the slot to `queued` rather than freeing it, so all
    // MAX_CONCURRENT_RENDERS owners (N-1 original fillers + the formerly-queued caller)
    // still hold a slot and must be released to bring activeRenders back to 0.
    releaseRenderSlots(MAX_CONCURRENT_RENDERS)
  })

  test('rejects a queued caller once QUEUE_TIMEOUT elapses', async () => {
    jest.useFakeTimers()
    await fillRenderSlots(MAX_CONCURRENT_RENDERS)
    const queued = acquireRenderSlot()
    const assertion = expect(queued).rejects.toThrow('Render queue timeout - service is overloaded')
    jest.advanceTimersByTime(QUEUE_TIMEOUT)
    await assertion
    jest.useRealTimers()
    releaseRenderSlots(MAX_CONCURRENT_RENDERS)
  })
})

describe('POST /public/v8/course/batch/cert/download/mobile', () => {
  test('decodes an svg payload', async () => {
    const svg = 'data:image/svg+xml,%3Csvg%3E%3C!-- id123 --%3Ehello%3C/svg%3E'
    const res = await request(app)
      .post('/public/v8/course/batch/cert/download/mobile')
      .send({ printUri: svg, outputFormat: 'svg' })
    expect(res.status).toBe(200)
    expect(res.text).not.toContain('<!--')
  })

  test('renders a pdf payload', async () => {
    const res = await request(app)
      .post('/public/v8/course/batch/cert/download/mobile')
      .send({ printUri: 'data:image/svg+xml,%3Csvg/%3E', outputFormat: 'pdf' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
  })

  test('renders a png payload', async () => {
    const res = await request(app)
      .post('/public/v8/course/batch/cert/download/mobile')
      .send({ printUri: 'data:image/svg+xml,%3Csvg/%3E', outputFormat: 'png' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
  })

  test('returns a generic error when the payload is malformed', async () => {
    const res = await request(app)
      .post('/public/v8/course/batch/cert/download/mobile')
      .send({ outputFormat: 'svg' })
    expect(res.status).toBe(500)
    expect(res.body.error).toBeDefined()
  })
})

describe('GET /public/v8/cert/download/:certId', () => {
  test('streams a png when the backend returns a printUri', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { result: { printUri: 'data:image/svg+xml,%3Csvg/%3E' } } })
    const res = await request(app).get('/public/v8/cert/download/cert-1')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
  })

  test('returns 400 when the backend has no data', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: {} })
    const res = await request(app).get('/public/v8/cert/download/cert-2')
    expect(res.status).toBe(400)
  })

  test('propagates the backend error status and body', async () => {
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 404, data: { error: 'not found' } } })
    const res = await request(app).get('/public/v8/cert/download/cert-3')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('not found')
  })
})

describe('GET /public/v8/milestone/cert/download/:certId', () => {
  test('streams a png when the backend returns a printUri', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { result: { printUri: 'data:image/svg+xml,%3Csvg/%3E' } } })
    const res = await request(app).get('/public/v8/milestone/cert/download/cert-1')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
  })

  test('returns 400 when printUri is missing', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: {} })
    const res = await request(app).get('/public/v8/milestone/cert/download/cert-2')
    expect(res.status).toBe(400)
  })

  test('returns 500 on unexpected backend failure', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).get('/public/v8/milestone/cert/download/cert-3')
    expect(res.status).toBe(500)
  })
})

describe('shutdown', () => {
  test('closes every browser in the pool and empties it', async () => {
    await initBrowserPool()
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((() => undefined) as unknown) as () => never)
    const closedBrowsers = browserPool.map((entry) => entry.browser)
    await shutdown()
    closedBrowsers.forEach((browser: any) => expect(browser.close).toHaveBeenCalled())
    expect(browserPool.length).toBe(0)
    expect(exitSpy).toHaveBeenCalledWith(0)
    exitSpy.mockRestore()
  })
})
