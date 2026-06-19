# Integrator — Stufe 1: Verlinkung — Design

**Goal:** Ein autonomer Hintergrund-Assistent, der frische/geänderte Notizen *integriert*,
indem er ihnen Backlinks zu semantisch verwandten Notizen vorschlägt — und so die Lücke
„Capture ist leicht, Integration ist schwer" schließt. Erste von drei Stufen
(**Verlinkung** → Struktur → Atomisierung). Nicht-destruktiv, lokal, minimale Review-Last.

**Architecture:** Ein Hintergrund-*Pass*, der vault-rags vorhandenes Retrieval
(`Retriever.related` aus Slice A) als Kandidaten-Quelle nutzt, deterministisch filtert und
Verlinkungs-Vorschläge in eine persistente **Review-Inbox** stellt. Der MVP-Kern ist
**embedding-basiert (kein LLM)** — deterministisch, offline-fähig, token-frei. Eine optionale
LLM-Veredelung (inline-Platzierung, Relevanz-Filter) ist eine spätere Verfeinerung, kein
MVP-Bestandteil. Schreibvorgänge laufen über das `VaultAdapter`-Interface, nie direkt gegen
die Obsidian-API (Architektur-Prinzip, Node-testbar).

**Tech Stack:** TypeScript strict, Obsidian Plugin API (`ItemView`), vitest + happy-dom,
natives `fetch` (nur für den optionalen späteren LLM-Schritt — Wiederverwendung von
`ChatClient`). Kein neues npm-Paket.

## Entscheidungen (aus dem Brainstorming, ratifiziert)

- **Heimat: das vault-rag-Plugin, nicht ein hyperforge-Daemon.** Begründung: Vault-Daten
  syncen über **Obsidian Sync** (an die laufende App gebunden) — ein headless Daemon brächte
  Ergebnisse nur auf die Platte, sie erreichten Mobile erst beim nächsten Obsidian-Start.
  „Obsidian offen" ist also ohnehin der reale Betriebszustand. Plus: Komplexitätsreduktion
  (ein Artefakt) + Veröffentlichbarkeit (ein Community-Plugin darf keinen externen Daemon
  voraussetzen).
- **Scope-Stufen.** ① **Verlinkung** (dieses MVP) → ② Struktur (Frontmatter-Vervollständigung,
  MOC-Einordnung — gleicher Vier-Schritt-Rahmen, eigene Spec) → ③ Atomisierung (späterer
  privater „Power-Modus" aus dem hyperforge-Reservoir, **nicht** Teil des veröffentlichten
  Plugins).
- **Propose-Kern embedding-basiert, kein LLM im MVP.** Slice A berechnet verwandte Notizen
  bereits per Cosinus über den gesyncten Index. Der Integrator handelt darauf — kein LLM-Call
  nötig. Folge: deterministisch, **offline-fähig** (statischer Index reicht), token-frei,
  vorhersehbar (Autismus-Constraint). LLM-Veredelung ist Stufe 1.5, opt-in.
- **Interaktion: Review-Inbox zuerst, Auto-Apply später.** Vorschläge sammeln sich in einer
  leichten Review-Ansicht; ein Hotkey setzt den Backlink. Start voll kontrolliert + vorhersehbar
  (Vertrauensaufbau). **Konfidenz-gestuftes Auto-Apply** (einstellbare Similarity-Schwelle,
  Default „aus") ist von Tag 1 in der Architektur, freischaltbar wenn Vertrauen da ist.
- **Nicht-destruktiv.** Backlinks werden **additiv + idempotent** gesetzt (zweimal Anwenden =
  ein Link), in einem klar abgegrenzten, maschinell erkennbaren `## Verwandte Notizen`-Abschnitt
  am Notiz-Ende → trivial reversibel, kein Eingriff in den Fließtext.
- **Veröffentlichungs-Disziplin (ab Tag 1).** Eigenständig (keine hyperforge-Abhängigkeit) ·
  Endpoints konfigurierbar · Vault-Konventionen (`_types`, MOC-Pfade) als **Settings-Profil**
  statt Hardcode, damit fremde Vaults eigene definieren können.
- **Online-Verhalten.** MVP-Kern offline-fähig (liest verwandte Notizen aus dem statischen
  Index). *Falls* die LLM-Veredelung (Stufe 1.5) aktiv ist, ist nur dieser Schritt online-only
  (erreichbarer Chat-Endpoint, wie Slice B).

## ADR-Bezug

- **ADR-009** (HyperForge retrieval-only): Die Schreib-/Editier-Logik lebt im Plugin, nicht im
  Backend. Konsistent — der Integrator schreibt im Plugin.
- **ADR-031** (neu, in hyperforge `20_Decisions/`): hyperforge wird **eingefrorenes Reservoir**,
  vault-rag wird das **Produkt**. Diese Spec ist die erste Slice, die vault-rag über reines
  Retrieval hinaus zum aktiven *Integrations*-Assistenten macht.

## Datenfluss

```
file:modify (geänderte Notiz, debounced — vorhandenes main.ts-Pattern)
  → proposeLinks(notePath, {retriever, adapter})
        ① Retriever.related(notePath, {k, minSim, exclude})   (Embedding, offline ok)
        ② Filter: Ziel schon verlinkt? unter Schwelle? self?  (deterministisch, kein LLM)
        → LinkProposal { notePath, links: {path, sim}[] }  |  null (nichts Neues)
  → IntegrationInbox.add(proposal)            (persistent in Plugin-data, KEIN Vault-Footprint)
  → [Review] IntegrationView: Hotkey „akzeptieren" → LinkWriter.apply(notePath, target)
        (additiv, idempotent, in ## Verwandte Notizen)
  → [optional Auto-Modus] sim ≥ autoApplyThreshold → LinkWriter.apply direkt + Aktivitäts-Log
```

## Komponenten

| Datei | Aktion | Zweck |
|---|---|---|
| `src/integrator.ts` | **neu** | `proposeLinks(notePath, deps): Promise<LinkProposal \| null>` (pure, obsidian-frei, nutzt `Retriever`+`VaultAdapter`); `IntegrationInbox` (add/list/resolve, persistiert in Plugin-data). |
| `src/link_writer.ts` | **neu** | `applyLink(adapter, notePath, target): Promise<void>` — additiv + idempotent; pflegt den `## Verwandte Notizen`-Abschnitt. Pure über `VaultAdapter`, Node-testbar. |
| `src/integrator_view.ts` | **neu** | `IntegrationView extends ItemView` (`VIEW_TYPE_INTEGRATION`): Vorschlagsliste, Akzeptieren/Ablehnen je Link + je Notiz, Hotkeys. Nutzt `renderHits`-Stil aus `view.ts`. |
| `src/settings.ts` | **ändern** | Sektion „Integrator": `integratorEnabled`, `linkK`, `linkMinSim`, `autoApplyThreshold` (0 = nur Review), `relatedHeading` (Default „Verwandte Notizen"), Konventions-Profil-Felder. |
| `src/main.ts` | **ändern** | `VIEW_TYPE_INTEGRATION` registrieren (Ribbon + Command); im vorhandenen `file:modify`-Debounce-Pfad nach dem Embedding `proposeLinks` triggern; Deps verdrahten. |

### Schnittstellen

```ts
// integrator.ts
export interface LinkProposal {
  notePath: string;
  links: { path: string; sim: number }[];
  createdAt: number;
}
export interface ProposerDeps {
  retriever: Retriever;          // Slice A — related(path, {k, minSim, exclude})
  adapter: VaultAdapter;         // zum Lesen bestehender Links (Filter)
  k: number; minSim: number;
}
export function proposeLinks(notePath: string, deps: ProposerDeps): Promise<LinkProposal | null>;

export class IntegrationInbox {
  add(p: LinkProposal): void;
  list(): LinkProposal[];
  resolve(notePath: string, acceptedTargets: string[]): void;  // entfernt aus Inbox
  // Persistenz über Plugin-data (saveData), NICHT in den Vault
}

// link_writer.ts
export async function applyLink(
  adapter: VaultAdapter, notePath: string, targetPath: string, heading: string,
): Promise<void>;  // additiv + idempotent: fügt [[target]] im `## <heading>`-Block ein, dedupe
```

## Out of scope (Stufe 1, bewusst — YAGNI)

- **Struktur** (Frontmatter-Vervollständigung, MOC-Einordnung) → Stufe 2, eigene Spec.
- **Atomisierung** → Stufe 3, privater Power-Modus, hyperforge-Reservoir.
- **LLM-veredelte inline-Platzierung** + Relevanz-Filter → Stufe 1.5, opt-in (nutzt `ChatClient`).
- **Auto-Apply als Default** → Architektur ist da, Default bleibt „nur Review".
- **Alltags-Assistent** (jenseits des Vaults) → geparkt (OpenClaw-Territorium).
- **Bidirektionale Doppel-Links** → unnötig; Obsidian zeigt Backlinks der Ziel-Notiz automatisch.

## Teststrategie (TDD Default)

- `proposeLinks`, `applyLink`, `IntegrationInbox` sind pure / `VaultAdapter`-basiert → Node-Tests
  ohne DOM-Mock (Architektur-Prinzip PROF-OBS-03/04).
- **Idempotenz-Test:** `applyLink` zweimal → genau ein `[[target]]`.
- **Filter-Test:** bereits verlinkte Ziele erscheinen nicht erneut im Vorschlag.
- **No-Vault-Footprint-Test:** Inbox persistiert in Plugin-data, schreibt nichts in den Vault,
  bis ein Link akzeptiert wird.
- View über `VaultAdapter`-Mock + happy-dom.
