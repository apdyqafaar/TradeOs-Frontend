import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-cleans when it can see a global `afterEach` at
// import time, which depends on load order. Doing it here is unconditional, so
// one spec's mounted tree can never leak into the next one's queries.
afterEach(() => {
  cleanup();
});
