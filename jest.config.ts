import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

const config: Config = {
  testEnvironment: "node",
  // `.tsx` suites (React components) opt into jsdom with a per-file
  // `@jest-environment jsdom` docblock; the default stays `node`.
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    // Map isomorphic-dompurify to a manual mock that uses native require
    // to bypass Jest's inability to transform jsdom's ESM-only dependencies
    "^isomorphic-dompurify$": "<rootDir>/__mocks__/isomorphic-dompurify.js",
  },
};

export default createJestConfig(config);
