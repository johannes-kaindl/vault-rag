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
  return [
    "---",
    `source_image: "[[${o.imageLink}]]"`,
    `source_note: "[[${o.sourceName}]]"`,
    `created: ${o.date}`,
    `transcribed_by: ${o.model}`,
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
