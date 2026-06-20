# Vision / IMG→MD — Design

**Goal:** Aus einem in eine Notiz eingebetteten Foto den Text per lokalem Vision-Modell nach
**strukturiertem Markdown** transkribieren, eine **neue Notiz** anlegen (Frontmatter-Referenz aufs Foto +
Foto-Embed oben + Transkript), und in der **Quellnotiz** den Bild-Link durch einen Embed der neuen Notiz
ersetzen. Auslösbar per **Command** (alle Bilder der aktiven Notiz, mobil-tauglich) **und** per
**Editor-Kontextmenü** am Bild.

**Architecture:** Reiner, Node-testbarer Kern + IO-Interface (wie das bestehende `VaultAdapter`-Muster).
Pure Funktionen (`findImageEmbeds`, `buildTranscriptNote`, `replaceEmbed`) und der Orchestrator `runImgToMd`
sprechen nur ein `ImgToMdIO`-Interface an; die Obsidian-Seite (Bild lesen, Notiz anlegen, Quellnotiz schreiben,
Embeds auflösen) wird in `main.ts` implementiert. Die Vision-Anbindung kapselt `VisionClient`.

**Erste Vault-Write-Capability:** Das Plugin schrieb bisher nur den `_vaultrag`-Index. IMG→MD **erstellt
Notizen und editiert die Quellnotiz** (über `app.vault.create`/`modify`). Bewusst nicht-destruktiv (s.u.).

**Tech Stack:** TypeScript strict, Obsidian Plugin API (`vault.create/modify`, `metadataCache.getFirstLinkpathDest`,
`adapter.readBinary`, `arrayBufferToBase64`, `editor-menu`), vitest. Slice A / Chat unverändert.

## Entscheidungen (Brainstorming 2026-06-20, ratifiziert)

- **Trigger:** Command „IMG → MD" auf der aktiven Notiz → alle eingebetteten Bilder; **plus** Editor-
  Kontextmenü-Eintrag am Bild (Bearbeiten-Modus) → nur das Bild auf der Cursor-Zeile. Beide rufen `runImgToMd`.
- **Vision-Modell:** eigener `visionEndpoint` (Default = Chat-Endpoint) + `visionModel`; Modell-Dropdown in den
  Settings via Reuse von `ChatClient.listModels`. `visionPrompt` editierbar.
- **Neue Notiz:** Frontmatter (`source_image`, `source_note`, `created`, `transcribed_by`) + Foto-Embed **oben** +
  Transkript. **Neben der Quellnotiz**, Name = Bilddateiname (`.md`), Zähler-Suffix bei Kollision.
- **Quellnotiz:** alle Vorkommen von `![[bild]]` → `![[neue-notiz]]`.
- **Bildformate:** png/jpg/jpeg/webp/gif → transkribierbar. **heic/heif/bmp** → erkannt, aber als
  **nicht unterstützt** übersprungen + klare Warn-Notice (HEIC ist iOS-Default; Hinweis „iOS auf 'Maximal
  kompatibel'").
- **Original-Bild bleibt liegen** (von der neuen Notiz referenziert) — nichts wird gelöscht/verschoben.
- **Non-streaming** Transkription + Fortschritts-Notice („Transkribiere Bild i/n…").
- **YAGNI:** keine OCR-Fallbacks, keine Bildbearbeitung, keine Lese-Modus-Kontextmenü (Command deckt ab), kein
  Batch über mehrere Notizen.

## Sicherheit (erste Write-Capability)

- Nichts wird gelöscht; Quellnotiz-Edit ist eine **Link-Ersetzung** (per Undo reversibel, Bild existiert weiter).
- **Idempotent:** zweiter Lauf findet keine Bild-Embeds mehr (bereits ersetzt) → No-op.
- Abschluss-Notice nennt Anzahl transkribiert/übersprungen.

## Komponenten

| Datei | Aktion | Zweck |
|---|---|---|
| `src/vision_client.ts` | **neu** | `VisionClient(endpoint, model).transcribe(dataUrl, prompt, signal?): Promise<string>` — multimodaler `/v1/chat/completions`-Call (Bild als `image_url`-Data-URL), **non-streaming**, gibt `choices[0].message.content` zurück; wirft bei HTTP-Fehler. |
| `src/img_to_md.ts` | **neu** | Pure: `findImageEmbeds(content) → {raw, link, ext}[]`; `buildTranscriptNote(opts) → string`; `replaceEmbed(content, raw, newBasename) → string`; `uniqueNotePath(io, dir, base)`. Orchestrator `runImgToMd(io, sourcePath, opts?) → {transcribed, skipped}` über `ImgToMdIO`. Konstanten `IMAGE_EXTS`/`SUPPORTED_EXTS`. |
| `src/settings.ts` | **ändern** | `visionEndpoint`/`visionModel`/`visionPrompt` + Defaults; Vision-Sektion: Endpoint + Modell-Dropdown (reuse) + Prompt-Textarea. |
| `src/main.ts` | **ändern** | `VisionClient` instanziieren (+ `reconnectVision`); `ImgToMdIO`-Impl mit Obsidian; Command + `editor-menu`-Eintrag. |

### Schnittstellen

```ts
// vision_client.ts
export class VisionClient {
  constructor(endpoint: string, model: string);
  transcribe(dataUrl: string, prompt: string, signal?: AbortSignal): Promise<string>;
  // Body: { model, messages:[{role:"user", content:[{type:"text",text:prompt},{type:"image_url",image_url:{url:dataUrl}}]}], stream:false }
}

// img_to_md.ts
export const IMAGE_EXTS: string[];      // png,jpg,jpeg,webp,gif,bmp,heic,heif
export const SUPPORTED_EXTS: string[];  // png,jpg,jpeg,webp,gif
export interface ImageEmbed { raw: string; link: string; ext: string }
export function findImageEmbeds(content: string): ImageEmbed[];   // ![[bild.ext]] + ![alt](pfad), externe http(s) ausgenommen
export function buildTranscriptNote(o: { imageLink: string; sourceName: string; date: string; model: string; transcript: string }): string;
export function replaceEmbed(content: string, raw: string, newBasename: string): string;  // alle Vorkommen, literal

export interface ImgToMdIO {
  model: string;
  date: () => string;
  readNote(path: string): Promise<string>;
  writeNote(path: string, content: string): Promise<void>;
  createNote(path: string, content: string): Promise<void>;
  noteExists(path: string): boolean;
  resolveImage(link: string, sourcePath: string): { path: string; ext: string } | null;
  readImageDataUrl(path: string, ext: string): Promise<string>;   // readBinary → base64 → data:image/…;base64,…
  transcribe(dataUrl: string): Promise<string>;
  notify(msg: string): void;
}
export function runImgToMd(io: ImgToMdIO, sourcePath: string, opts?: { onlyRaw?: string }): Promise<{ transcribed: number; skipped: number }>;
```

## Datenfluss (`runImgToMd`)

```
content = io.readNote(sourcePath)
embeds  = findImageEmbeds(content)         (opts.onlyRaw → nur dieses Embed)
für jedes embed e:
  resolved = io.resolveImage(e.link, sourcePath)         (nicht gefunden → notify+skip)
  ext nicht in SUPPORTED → notify("Format … nicht unterstützt")+skip
  notify("Transkribiere i/n…")
  dataUrl = io.readImageDataUrl(resolved.path, resolved.ext)
  transcript = io.transcribe(dataUrl).trim()             (Fehler/leer → notify+skip)
  newPath = uniqueNotePath(io, dirOf(sourcePath), basenameNoExt(resolved.path))
  io.createNote(newPath, buildTranscriptNote({imageLink:e.link, sourceName, date:io.date(), model:io.model, transcript}))
  content = replaceEmbed(content, e.raw, basenameNoExt(newPath))
io.writeNote(sourcePath, content)  (nur wenn geändert)
notify("N transkribiert[, M übersprungen]")
```

**Neue-Notiz-Vorlage (`buildTranscriptNote`):**
```
---
source_image: "[[<imageLink>]]"
source_note: "[[<sourceName>]]"
created: <date>
transcribed_by: <model>
---
![[<imageLink>]]

<transcript>
```

## Obsidian-Seite (`main.ts`, `ImgToMdIO`)

- `readNote`/`writeNote` → `app.vault.adapter.read/write` bzw. `vault.modify(TFile)`; `createNote` → `vault.create(path, content)`.
- `resolveImage` → `app.metadataCache.getFirstLinkpathDest(link, sourcePath)` → `{path: file.path, ext: file.extension}`.
- `readImageDataUrl` → `adapter.readBinary(path)` → `arrayBufferToBase64(ab)` → `data:image/${mime(ext)};base64,${b64}` (`jpg`→`jpeg`).
- `noteExists` → `vault.getAbstractFileByPath(path) != null`.
- `transcribe` → `visionClient.transcribe(dataUrl, settings.visionPrompt)`. `model` = `settings.visionModel`. `date` = aktuelles Datum `YYYY-MM-DD`. `notify` → `new Notice`.
- **Command** `img-to-md`: aktive Datei → `runImgToMd(io, file.path)`. **editor-menu**: Bild-Embed auf der Cursor-Zeile via `findImageEmbeds(editor.getLine(...))` erkennen → Eintrag „IMG → MD" → `runImgToMd(io, file.path, { onlyRaw })`.

## Zustände / Fehlerbehandlung

- Keine aktive Datei / keine Bilder → Notice, kein Schreiben.
- Vision-Endpoint offline / HTTP-Fehler → `transcribe` wirft → notify, Embed übersprungen, Quellnotiz unverändert für dieses Bild.
- Nicht-unterstütztes Format (heic/heif/bmp) → notify + skip.
- Leeres Transkript → keine Notiz anlegen, notify + skip.
- Namens-Kollision → `uniqueNotePath` hängt `-2`, `-3`, … an.
- Mehrere Embeds desselben Bildes → `replaceEmbed` ersetzt alle Vorkommen; eine neue Notiz.

## Tests (TDD, vitest)

- `tests/vision_client.test.ts` — `transcribe`: Request-Body-Shape (content-Array mit `text` + `image_url`-Data-URL, `stream:false`); Antwort-Parsing `choices[0].message.content`; HTTP-Fehler wirft.
- `tests/img_to_md.test.ts` — `findImageEmbeds`: wikilink + markdown, Extensions-Filter, externe URLs aus, mehrere, `#`/`|` im Link. `buildTranscriptNote`: Frontmatter + Embed-oben + Transkript. `replaceEmbed`: alle Vorkommen, literal (keine Regex-Sonderzeichen-Probleme). `uniqueNotePath`: Zähler bei Kollision. `runImgToMd` mit Fake-IO: Happy-Path (createNote + writeNote + Counts), kein Bild (Notice, kein Write), nicht-unterstütztes Format (skip), leeres Transkript (kein createNote), `onlyRaw` (nur ein Embed), Kollision→Zähler, Transkriptions-Fehler (skip, kein Crash).
- `tests/settings.test.ts` — neue Vision-Defaults (`visionEndpoint`, `visionModel`, `visionPrompt`).

## Self-Review

- **Placeholder-Scan:** kein TBD/TODO.
- **Konsistenz:** reiner Kern + `ImgToMdIO`; Obsidian-API nur in `main.ts`; `VisionClient` kapselt den multimodalen Call; `date`/`model` injiziert → `runImgToMd` deterministisch testbar.
- **Scope:** ein Plan. HEIC-Konvertierung, Lese-Modus-Menü, Multi-Notiz-Batch bewusst raus.
- **Ambiguität:** „Foto im Frontmatter" = `source_image`-Ref **und** Body-Embed oben (ratifiziert); Name = Bilddateiname; unsupported = skip+warn (nicht still); Quellnotiz-Schreiben nur bei Änderung.
- **Risiko:** Command/`editor-menu`-Verdrahtung + `arrayBufferToBase64` sind Obsidian-API (in `main.ts`, nur tsc-geprüft); der gesamte Kern (`findImageEmbeds`/`buildTranscriptNote`/`replaceEmbed`/`runImgToMd`/`VisionClient`) ist mit Fake-IO/fetch-Stub unit-getestet.
