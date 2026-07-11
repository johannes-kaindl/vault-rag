/** Auth-Helfer für den in-Plugin MCP-HTTP-Server. Reine Funktionen, kein node:-Builtin
 *  (crypto.getRandomValues ist in Electron-Renderer und Node 18+ global verfügbar). */

/** 128-bit Zufallstoken als 32 Hex-Zeichen. */
export function generateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

/** true, wenn der Request autorisiert ist. Leerer Server-Token = Auth aus (alles erlaubt).
 *  Sonst muss der Header exakt "Bearer <token>" sein. */
export function isAuthorized(authHeader: string | undefined, token: string): boolean {
  if (!token) return true;
  return authHeader === `Bearer ${token}`;
}
