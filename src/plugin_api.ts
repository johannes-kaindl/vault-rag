import { VaultIndex } from "./index";
import { RetrievalFacade } from "./retrieval_facade";

/** Version des öffentlichen Vertrags. Wird bei jeder brechenden Änderung erhöht;
 *  Konsumenten prüfen sie, bevor sie sich auf die Form der Rückgaben verlassen. */
export const VAULT_RETRIEVAL_API_VERSION = 1;

export interface ApiHit {
  /** Vault-relativer Pfad der Notiz. */
  path: string;
  /** Roher Cosinus-Ähnlichkeitswert. Bewusst ungerundet — Darstellung entscheidet der Konsument. */
  score: number;
}

/** Erwartbare Zustände sind WERTE, keine Ausnahmen: ein Fremdplugin soll `ok` prüfen,
 *  nicht raten, welche Fehlerklasse ein `throw` transportiert. `reason` ist ein
 *  maschinenlesbarer Code ohne übersetzten Text — die Formulierung gehört dem Aufrufer. */
export type ApiResult =
  | { ok: true; hits: ApiHit[] }
  | { ok: false; reason: "no-index" }
  | { ok: false; reason: "offline" }
  | { ok: false; reason: "not-indexed"; path: string };

export interface ApiStatus {
  apiVersion: number;
  /** Ein Index ist geladen. Sagt NICHTS über die Erreichbarkeit des Embedding-Endpunkts —
   *  das ließe sich nur mit einem Netzaufruf beantworten, und `status()` macht keinen. */
  indexed: boolean;
  /** Zahl der indexierten Notizen (0 ohne Index). */
  noteCount: number;
}

/** Pro Anfrage überschreibbar. `exclude` fehlt hier absichtlich: die Ausschluss-Liste
 *  ist eine Nutzergrenze aus den Einstellungen, kein Tuning-Parameter des Aufrufers. */
export interface ApiOverrides {
  k?: number;
  minSim?: number;
}

/** Vertrag, den vault-rag anderen Obsidian-Plugins als `plugin.api` anbietet.
 *  Zugriff: `app.plugins.plugins["vault-retrieval"]?.api` (defensiv lesen — das Plugin
 *  kann fehlen oder deaktiviert sein). */
export interface VaultRetrievalApi {
  readonly apiVersion: number;
  /** Synchron und netzfrei — gedacht für die Frage „kann ich Retrieval überhaupt anbieten?". */
  status(): ApiStatus;
  /** Freitext → semantisch ähnliche Notizen. Braucht einen erreichbaren Embedding-Endpunkt. */
  search(query: string, opts?: ApiOverrides): Promise<ApiResult>;
  /** Notizpfad → verwandte Notizen. Rein offline aus dem Index, kein Netz, auch mobil. */
  related(path: string, opts?: ApiOverrides): Promise<ApiResult>;
}

/** Dünner Adapter über die geteilte RetrievalFacade — dasselbe Muster wie `mcp/tools.ts`.
 *  Bewusst NICHT die Facade selbst: die trägt zusätzlich readNote/embedQuery/searchVector
 *  (Dateizugriff und Vektor-Interna, beides ausdrücklich kein Teil des externen Vertrags)
 *  und ist unser internes Refactoring-Objekt. */
export function createVaultRetrievalApi(
  facade: RetrievalFacade,
  getIndex: () => VaultIndex | null,
): VaultRetrievalApi {
  return {
    apiVersion: VAULT_RETRIEVAL_API_VERSION,

    status() {
      const index = getIndex();
      return {
        apiVersion: VAULT_RETRIEVAL_API_VERSION,
        indexed: index !== null,
        noteCount: index ? index.paths.length : 0,
      };
    },

    async search(query, opts) {
      return toApiResult(await facade.search(query, pick(opts)));
    },

    async related(path, opts) {
      return toApiResult(facade.related(path, pick(opts)));
    },
  };
}

/** Nur k/minSim durchreichen. Ein Fremdplugin darf uns kein `exclude` unterschieben —
 *  ohne diese Filterung würde ein zusätzliches Feld im Objekt bis zum Retriever durchlaufen. */
function pick(opts?: ApiOverrides): { k?: number; minSim?: number } {
  return { k: opts?.k, minSim: opts?.minSim };
}

type FacadeResult =
  | { kind: "hits"; hits: ApiHit[] }
  | { kind: "no-index" }
  | { kind: "offline" }
  | { kind: "not-indexed"; path: string };

/** Interne Unions (Compile-Zeit) → laufzeit-lesbarer Diskriminator.
 *  Ein Fremdplugin kann unsere Typen nicht importieren; `ok` muss man anfassen können. */
function toApiResult(r: FacadeResult): ApiResult {
  switch (r.kind) {
    case "hits": return { ok: true, hits: r.hits.map(h => ({ path: h.path, score: h.score })) };
    case "not-indexed": return { ok: false, reason: "not-indexed", path: r.path };
    case "offline": return { ok: false, reason: "offline" };
    case "no-index": return { ok: false, reason: "no-index" };
  }
}
