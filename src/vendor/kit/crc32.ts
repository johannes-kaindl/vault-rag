// vendored from code-kit@0.37.2, src/ts/pure/crc32.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus vault-rag/src/index_container.ts:30, 2026-10-11 (derselbe Algorithmus steht byte-gleich in epub-exporter/src/core/zip-writer.ts:19)
/** CRC-32/ISO-HDLC — the checksum of zlib, gzip, PNG and zip (polynomial 0xEDB88320, reflected, initial value and
 *  final XOR 0xFFFFFFFF). Returned UNSIGNED. `crc32("123456789")` is `0xCBF43926`.
 *
 *  Origin: vault-rag's container index (`index.bin` ends in this checksum). epub-exporter's zip writer carries the
 *  same algorithm a second time; it can take this module the next time it is touched. */

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
