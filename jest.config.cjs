module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/jest.setup.js'],
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js'],
};
