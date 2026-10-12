import { axiosRequestConfig, axiosRequestConfigLong, axiosRequestConfigVeryLong } from './request.config'

describe('request.config', () => {
  test('axiosRequestConfig is tuned for fast, non-retried calls', () => {
    expect(axiosRequestConfig).toEqual({ retry: 0, retryDelay: 1, timeout: 10000 })
  })

  test('axiosRequestConfigLong retries a handful of times with a longer timeout', () => {
    expect(axiosRequestConfigLong).toEqual({ retry: 3, retryDelay: 1, timeout: 20000 })
  })

  test('axiosRequestConfigVeryLong allows a single retry with a very long timeout', () => {
    expect(axiosRequestConfigVeryLong).toEqual({ retry: 1, retryDelay: 1, timeout: 200000 })
  })
})
