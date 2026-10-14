// Der Obsidian-Mock ist der Kit-Mock (tests/vendor/kit/obsidian-mock.ts, vendort, nie von Hand ändern).
// Einzige Abweichung, deklariert: `requestUrl` ist hier ein vitest-`vi.fn()`. Der Kit-Mock bringt einen eigenen
// `MockFn` ohne vitest-Abhängigkeit mit (kein `mockReset`, kein `vi.mocked`), die Tests in chat_client/capabilities
// brauchen beides. Kit-Befund an den Master gemeldet (Welle 22): `requestUrl` im Kit-Mock als Parameter oder als
// vi-kompatibles Objekt anbieten; danach entfällt diese Zeile.
import { vi } from "vitest";
export * from "../vendor/kit/obsidian-mock";
export const requestUrl = vi.fn();
