/** Auth-Helfer für den in-Plugin MCP-HTTP-Server. Reine Funktionen, kein node:-Builtin
 *  (crypto.getRandomValues ist in Electron-Renderer und Node 18+ global verfügbar). */

/** 128-bit Zufallstoken als 32 Hex-Zeichen. */
export function generateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

/** Zeitkonstanter String-Vergleich (verhindert Timing-Seitenkanal beim Token-Check).
 *  Kein node:crypto — dieses Modul bleibt bewusst node-builtin-frei. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** true, wenn der Request autorisiert ist. Leerer Server-Token = Auth aus (alles erlaubt).
 *  Sonst muss der Header exakt "Bearer <token>" sein (zeitkonstanter Vergleich). */
export function isAuthorized(authHeader: string | undefined, token: string): boolean {
  if (!token) return true;
  return timingSafeEqual(authHeader ?? "", `Bearer ${token}`);
}
