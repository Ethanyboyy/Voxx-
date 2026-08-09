// Environment variables for the test run live in vitest.config.ts (`test.env`)
// so they're guaranteed to be set before any module — in particular
// src/lib/db.ts, which reads DATABASE_URL at import time — is evaluated.
export {};
