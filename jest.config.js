module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  modulePathIgnorePatterns: ['<rootDir>/tools/'],
  watchman: false,
};
