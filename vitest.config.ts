import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Run tests sequentially to avoid ExifTool conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Increase timeout for ExifTool operations
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 30000,
  },
})
