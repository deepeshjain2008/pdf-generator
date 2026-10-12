/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  collectCoverage: true,
  collectCoverageFrom: [
    'app.ts',
    'utils/**/*.ts',
    'configs/**/*.ts',
    '!**/*.test.ts',
    '!**/*.d.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: {
      branches: 93,
      functions: 93,
      lines: 93,
      statements: 93
    }
  },
  clearMocks: true,
  restoreMocks: true
}
