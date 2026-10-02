module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],
  globalTeardown: "<rootDir>/tests/teardown.js",
  testTimeout: 45000,
  forceExit: true,
  verbose: true,
};
