// normalizeEndpoint + resolveActiveEndpoint stammen aus obsidian-kit (entdoppelt, gepinnt 0.2.0).
// Re-Export hier, damit bestehende Importe `import { normalizeEndpoint } from "./endpoint"`
// unverändert funktionieren und resolveActiveEndpoint über denselben Pfad verfügbar ist.
export { normalizeEndpoint, resolveActiveEndpoint } from "obsidian-kit/pure";
