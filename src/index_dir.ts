import { normalizeFolder } from "./vendor/kit/folder-hide";

/** Pfade mit `.`-Präfix werden von Obsidian Sync ignoriert (außer `.obsidian`). */
export function isDotPath(raw: string): boolean {
  return normalizeFolder(raw).startsWith(".");
}
