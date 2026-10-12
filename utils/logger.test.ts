// The logger module captures `console.log` into its own `log` const at import time
// (`export const log = console.log`), so the spy has to be installed *before* the
// module is first required in each test - hence the dynamic require() below instead
// of a static top-level import.
describe('logger', () => {
  let consoleSpy: jest.SpyInstance
  let logger: typeof import('./logger')

  beforeEach(() => {
    jest.resetModules()
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    logger = require('./logger')
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  test('logInfo writes its arguments to the console', () => {
    logger.logInfo('hello', 'world')
    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(consoleSpy.mock.calls[0][0]).toContain('hello')
  })

  test('logWarn writes its arguments to the console', () => {
    logger.logWarn('careful')
    expect(consoleSpy.mock.calls[0][0]).toContain('careful')
  })

  test('logError writes its arguments to the console', () => {
    logger.logError('boom')
    expect(consoleSpy.mock.calls[0][0]).toContain('boom')
  })

  test('logSuccess writes its arguments to the console', () => {
    logger.logSuccess('done')
    expect(consoleSpy.mock.calls[0][0]).toContain('done')
  })

  test('logInfoHeading writes the heading to the console', () => {
    logger.logInfoHeading('Info Section')
    expect(consoleSpy.mock.calls[0][0]).toContain('Info Section')
  })

  test('logWarnHeading writes the heading to the console', () => {
    logger.logWarnHeading('Warn Section')
    expect(consoleSpy.mock.calls[0][0]).toContain('Warn Section')
  })

  test('logErrorHeading writes the heading to the console', () => {
    logger.logErrorHeading('Error Section')
    expect(consoleSpy.mock.calls[0][0]).toContain('Error Section')
  })

  test('logSuccessHeading writes the heading to the console', () => {
    logger.logSuccessHeading('Success Section')
    expect(consoleSpy.mock.calls[0][0]).toContain('Success Section')
  })

  test('logObject renders a heading, a separator and the sorted key/value pairs', () => {
    logger.logObject('Config', {
      zeta: 'last',
      alpha: 1,
      flag: true,
      missing: undefined,
      empty: null
    })

    expect(consoleSpy).toHaveBeenCalledTimes(3)
    expect(consoleSpy.mock.calls[0][0]).toContain('Config')
    expect(consoleSpy.mock.calls[1][0]).toMatch(/_+/)
    const body = consoleSpy.mock.calls[2][0]
    expect(body).toContain('alpha')
    expect(body).toContain('1')
    expect(body).toContain('zeta')
    expect(body).toContain('last')
    expect(body).toContain('true')
    expect(body).toContain('undefined')
    expect(body).toContain('null')
  })
})
