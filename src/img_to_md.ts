export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif"];
export const SUPPORTED_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];

export interface ImageEmbed { raw: string; link: string; ext: string }

function extOf(link: string): string {
  const clean = link.split("#")[0].split("|")[0].trim();
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

/** Findet eingebettete Bilder: ![[link.ext]] (Wikilink) und ![alt](pfad) (Markdown, externe http(s) aus). */
export function findImageEmbeds(content: string): ImageEmbed[] {
  const out: ImageEmbed[] = [];
  let m: RegExpExecArray | null;
  const wiki = /!\[\[([^\]]+?)\]\]/g;
  while ((m = wiki.exec(content)) !== null) {
    const link = m[1].split("#")[0].split("|")[0].trim();
    const ext = extOf(link);
    if (IMAGE_EXTS.includes(ext)) out.push({ raw: m[0], link, ext });
  }
  const md = /!\[[^\]]*\]\(([^)]+?)\)/g;
  while ((m = md.exec(content)) !== null) {
    const link = m[1].trim();
    if (/^https?:\/\//i.test(link)) continue;
    const ext = extOf(link);
    if (IMAGE_EXTS.includes(ext)) out.push({ raw: m[0], link, ext });
  }
  return out;
}

/** Baut die Transkript-Notiz: Frontmatter-Ref + Foto-Embed oben + Transkript. */
export function buildTranscriptNote(o: { imageLink: string; sourceName: string; date: string; model: string; transcript: string }): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');   // YAML-Doppelquote-String — schützt vor Frontmatter-Bruch
  return [
    "---",
    `source_image: "[[${esc(o.imageLink)}]]"`,
    `source_note: "[[${esc(o.sourceName)}]]"`,
    `created: ${o.date}`,
    `transcribed_by: "${esc(o.model)}"`,
    "---",
    `![[${o.imageLink}]]`,
    "",
    o.transcript,
    "",
  ].join("\n");
}

/** Ersetzt alle Vorkommen des Bild-Embeds (literal) durch einen Embed der neuen Notiz. */
export function replaceEmbed(content: string, raw: string, newBasename: string): string {
  return content.split(raw).join(`![[${newBasename}]]`);
}

/** Erzeugt einen kollisionsfreien Notiz-Pfad (Zähler-Suffix bei Konflikt). */
export function uniqueNotePath(io: { noteExists(p: string): boolean }, dir: string, base: string): string {
  const join = (n: string) => (dir ? `${dir}/${n}.md` : `${n}.md`);
  if (!io.noteExists(join(base))) return join(base);
  let i = 2;
  while (io.noteExists(join(`${base}-${i}`))) i++;
  return join(`${base}-${i}`);
}

function dirOf(path: string): string { const i = path.lastIndexOf("/"); return i >= 0 ? path.slice(0, i) : ""; }
function basenameNoExt(path: string): string { const b = path.slice(path.lastIndexOf("/") + 1); const d = b.lastIndexOf("."); return d >= 0 ? b.slice(0, d) : b; }

export interface ImgToMdIO {
  model: string;
  date: () => string;
  readNote(path: string): Promise<string>;
  writeNote(path: string, content: string): Promise<void>;
  createNote(path: string, content: string): Promise<void>;
  noteExists(path: string): boolean;
  resolveImage(link: string, sourcePath: string): { path: string; ext: string } | null;
  readImageDataUrl(path: string, ext: string): Promise<string>;
  transcribe(dataUrl: string): Promise<string>;
  notify(msg: string): void;
}

/** Transkribiert die Bilder einer Notiz nach Markdown, legt je Bild eine Notiz an und
 *  ersetzt den Bild-Link durch einen Embed der neuen Notiz. Nicht-destruktiv, idempotent. */
export async function runImgToMd(io: ImgToMdIO, sourcePath: string, opts?: { onlyRaw?: string }): Promise<{ transcribed: number; skipped: number }> {
  const content = await io.readNote(sourcePath);
  let embeds = findImageEmbeds(content);
  if (opts?.onlyRaw) embeds = embeds.filter(e => e.raw === opts.onlyRaw);
  // Pro Bild-Datei nur einmal: dasselbe Bild mehrfach eingebettet → eine Notiz;
  // replaceEmbed ersetzt unten ohnehin ALLE Vorkommen des raw-Strings.
  const seen = new Set<string>();
  embeds = embeds.filter(e => { if (seen.has(e.link)) return false; seen.add(e.link); return true; });
  if (!embeds.length) { io.notify("Keine (passenden) Bilder in dieser Notiz."); return { transcribed: 0, skipped: 0 }; }
  const sourceName = basenameNoExt(sourcePath);
  const dir = dirOf(sourcePath);
  let updated = content;
  let transcribed = 0, skipped = 0;
  for (let i = 0; i < embeds.length; i++) {
    const e = embeds[i];
    const resolved = io.resolveImage(e.link, sourcePath);
    if (!resolved) { io.notify(`Bild nicht gefunden: ${e.link}`); skipped++; continue; }
    if (!SUPPORTED_EXTS.includes(resolved.ext.toLowerCase())) { io.notify(`Format .${resolved.ext} nicht unterstützt (HEIC? iOS auf „Maximal kompatibel"): ${e.link}`); skipped++; continue; }
    io.notify(`Transkribiere Bild ${i + 1}/${embeds.length}…`);
    let transcript: string;
    try {
      const dataUrl = await io.readImageDataUrl(resolved.path, resolved.ext);
      transcript = (await io.transcribe(dataUrl)).trim();
    } catch (err) { io.notify(`Transkription fehlgeschlagen (${e.link}): ${err instanceof Error ? err.message : String(err)}`); skipped++; continue; }
    if (!transcript) { io.notify(`Leeres Transkript: ${e.link}`); skipped++; continue; }
    const newPath = uniqueNotePath(io, dir, basenameNoExt(resolved.path));
    await io.createNote(newPath, buildTranscriptNote({ imageLink: e.link, sourceName, date: io.date(), model: io.model, transcript }));
    updated = replaceEmbed(updated, e.raw, basenameNoExt(newPath));
    transcribed++;
  }
  if (updated !== content) await io.writeNote(sourcePath, updated);
  io.notify(`${transcribed} Bild(er) transkribiert${skipped ? `, ${skipped} übersprungen` : ""}.`);
  return { transcribed, skipped };
}
