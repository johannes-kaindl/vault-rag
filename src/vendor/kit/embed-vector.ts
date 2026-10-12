// vendored from code-kit@0.24.0, src/ts/pure/embed-vector.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// uebernommen aus vault-rag/src/embed_vector.ts, 2026-10-11 (Änderungen: `dim` ohne Default 256, `noUncheckedIndexedAccess`-clean; gleiche Rechnung Schritt für Schritt)
/** Embeddings → truncate to `dim` (Matryoshka) → mean → L2-normalise.
 *  The ONE source of this transformation: used by the note path (indexer) AND the query path, so that both land
 *  in the same vector space. `dim` has no default any more: the old 256 sat in the signature of a function two
 *  consumers share, and a second index with 1024 dimensions must not get it by omission.
 *
 *  A source with fewer values than `dim` gives a vector of its own length (not an error): when it is written to an
 *  index with `dim` columns the rest is zero, which changes neither a dot product nor a norm. Mixing models is
 *  what the index guard refuses, not this function. */
export function toIndexVector(vecs: Float32Array[], dim: number): Float32Array {
  const d = Math.min(dim, vecs[0]?.length ?? 0);
  const mean = new Float32Array(d);
  for (const v of vecs) for (let i = 0; i < d; i++) mean[i] = (mean[i] ?? 0) + (v[i] ?? 0) / vecs.length;
  let norm = 0;
  for (let i = 0; i < d; i++) norm += (mean[i] ?? 0) * (mean[i] ?? 0);
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < d; i++) mean[i] = (mean[i] ?? 0) / norm;
  return mean;
}
