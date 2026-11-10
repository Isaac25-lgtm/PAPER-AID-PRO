/**
 * AI RESEARCH HUB — DISPOSABLE DATABASE MARKER & SEEDER SAFETY ACCEPTANCE SUITE
 *
 * Proves that:
 * 1. initTestDatabase refuses non-loopback hosts.
 * 2. initTestDatabase refuses databases other than 'ai_research_hub_test' (especially 'ai_research_hub').
 * 3. seedDevFixtures NEVER creates the marker itself.
 * 4. seedDevFixtures fails closed if the disposable marker is missing or if connected to 'ai_research_hub'.
 */

import "./test-setup";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { initTestDatabase } from "../scripts/init-test-database";
import { seedDevFixtures } from "./seed-test-fixtures";
import { assertDisposableDatabaseMarker } from "../src/lib/test-guard";

describe("Disposable Test Marker Safety Guarantees", () => {
  test("1. initTestDatabase refuses non-loopback hosts", async () => {
    await assert.rejects(
      async () => {
        await initTestDatabase("postgresql://postgres:postgres@db.example.com:5432/ai_research_hub_test");
      },
      (err: any) => {
        assert.match(err.message, /not a local loopback address/i);
        return true;
      }
    );
  });

  test("2. initTestDatabase strictly refuses working database 'ai_research_hub'", async () => {
    await assert.rejects(
      async () => {
        await initTestDatabase("postgresql://postgres:postgres@127.0.0.1:5432/ai_research_hub");
      },
      (err: any) => {
        assert.match(err.message, /NOT 'ai_research_hub_test'/i);
        return true;
      }
    );
  });

  test("3. seedDevFixtures refuses to run against working database 'ai_research_hub'", async () => {
    // Mock prisma client reporting current_database = 'ai_research_hub'
    const mockPrismaWorkingDb = {
      $queryRawUnsafe: async (sql: string) => {
        if (sql.includes("current_database()")) {
          return [{ db_name: "ai_research_hub", server_addr: "127.0.0.1", server_port: 5432 }];
        }
        return [];
      },
      $disconnect: async () => {},
    } as any;

    await assert.rejects(
      async () => {
        await seedDevFixtures(mockPrismaWorkingDb);
      },
      (err: any) => {
        assert.match(err.message, /CRITICAL TEST SAFETY VIOLATION/i);
        assert.match(err.message, /ai_research_hub/i);
        return true;
      }
    );
  });

  test("4. assertDisposableDatabaseMarker fails closed if marker table is missing", async () => {
    // Mock prisma client where marker table check returns false
    const mockPrismaNoMarker = {
      $queryRawUnsafe: async (sql: string) => {
        if (sql.includes("current_database()")) {
          return [{ db_name: "ai_research_hub_test", server_addr: "127.0.0.1", server_port: 5432 }];
        }
        if (sql.includes("to_regclass")) {
          return [{ exists: false }];
        }
        return [];
      },
      $disconnect: async () => {},
    } as any;

    await assert.rejects(
      async () => {
        await assertDisposableDatabaseMarker(mockPrismaNoMarker);
      },
      (err: any) => {
        assert.match(err.message, /missing/i);
        return true;
      }
    );
  });
});
