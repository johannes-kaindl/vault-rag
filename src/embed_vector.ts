/** Embeddings → auf `dim` truncaten (Matryoshka) → Mean → L2-normalisieren.
 *  Einzige Quelle dieser Transformation: von Notiz-Pfad (live_indexer) UND Query-Pfad genutzt,
 *  damit beide im selben Vektorraum landen. */
export function toIndexVector(vecs: Float32Array[], dim = 256): Float32Array {
  const d = Math.min(dim, vecs[0]?.length ?? 0);
  const mean = new Float32Array(d);
  for (const v of vecs) for (let i = 0; i < d; i++) mean[i] += v[i] / vecs.length;
  let norm = 0;
  for (let i = 0; i < d; i++) norm += mean[i] * mean[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < d; i++) mean[i] /= norm;
  return mean;
}
