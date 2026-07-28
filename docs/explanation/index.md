# Explanation

> **Diátaxis: Explanation.** Understanding-oriented: why the plugin is built this way, and what
> the trade-offs are. Nothing here is required to use it — see the [Tutorial](../tutorial.md).

## Why this plugin exists

Three separate AI plugins can happily compute three separate sets of embeddings over the same
vault with the same model. That is the same work three times, the same disk space three times,
and three subtly different answers to the same question. Vault Retrieval exists to be the one
retrieval layer that other things build on.

That framing drives the central split: **retrieval is not generation.** Finding what you wrote
is cheap, deterministic and can run anywhere. Generating text is expensive and needs a model.
Keeping them apart means the everyday feature — "what else did I write about this?" — has no
dependency on a running server at all.

## The index

The index is one vector per note: 256 dimensions, int8, mean-aggregated from the note's chunks.
For a few thousand notes that is around 1.4 MB.

Every part of that is a deliberate trade:

- **Note-level, not chunk-level.** Chunk-level retrieval is more precise and much larger, and it
  answers "which paragraph" — but the question this plugin serves is "which note". Notes are
  what you open, link and think in.
- **256 dimensions.** The embedding models produce far more; the vectors are Matryoshka-style
  truncations, which keep most of the ranking quality at a fraction of the size. Ranking
  quality, not absolute similarity values, is what matters for a top-k list.
- **int8 instead of float32.** A quarter of the size, and the quantisation error is well below
  the differences that decide a ranking. Vectors are renormalised after dequantisation to undo
  the drift quantisation introduces.
- **Brute-force cosine, no ANN index.** A few thousand dot products over a contiguous typed
  array is microseconds of work. An approximate-nearest-neighbour structure would add build
  time, memory, complexity and a second thing that can be corrupted — to speed up something
  that is already imperceptible.

The result is small enough to sync with the vault. That is the whole point: **your phone gets
the same retrieval as your laptop**, with no server, no VPN and no on-device model.

## Why the index defends itself

The index is derived data — every vector can be recomputed from your notes. But recomputing
costs an hour of GPU time, so in practice it behaves like data you do not want to lose. And it
sits in a folder that a sync service writes to from multiple devices.

That combination produces failure modes that a naive writer would silently turn into data loss:

- A device that starts while a sync download is still running sees an incomplete index. If it
  concluded "the index is nearly empty" and wrote that back, a small index would propagate to
  every device.
- A truncated `notes.i8` — half a download — would otherwise be read as garbage vectors and
  produce confidently wrong results.

So the plugin is deliberately reluctant. Writes that would shrink the index are refused rather
than performed. Before a live write it re-reads the real state from disk instead of trusting a
cached count. Damage found on load switches the plugin to read-only and says so out loud, rather
than "fixing" it by overwriting. When a reload delivers a worse index than the one in memory,
the good one is kept.

The guiding rule: **when in doubt, refuse and tell the user.** A plugin that stops working
visibly is recoverable. A plugin that quietly writes a smaller index is not.

### The limit of this approach

Guards protect the moments when *the plugin* writes. They cannot protect the moments when *the
sync service* writes.

The index is three files. Sync services resolve conflicts per file, with no notion that these
three belong together. Two devices can therefore produce a state that neither of them ever
wrote: a manifest from one generation next to a matrix from another. The byte check catches it
on load — the counts won't match — and the plugin refuses to write. But detection is not
prevention, and this is a known open problem rather than a solved one. Fixing it properly means
changing how the index is stored, not adding another check.

## Why empty notes are not "missing"

Folder notes, stubs and frontmatter-only files produce no chunks, so they get no vector. A naive
gap check would report them forever as missing and offer a repair that cannot succeed.

They are therefore classified separately: not indexed, not missing, and excluded from the repair
run. That classification is deliberately **not** persisted — it is recomputed on every load from
what is actually on disk, because a stub you fill in today should quietly become a normal
indexed note tomorrow without any bookkeeping to invalidate.

## Why Smart Apply rebuilds from your bytes

Asking a model to restructure a note invites it to improve the prose while it is there. That is
exactly what you do not want when reorganising your own writing.

So the model is not asked for the text. It is asked where each block belongs; the body is then
rebuilt from your original bytes under the headings it chose. A diff gate shows the move before
anything is written. The failure mode this design accepts — a block routed under the wrong
heading — is visible and trivially undone. The failure mode it removes — subtly rewritten
sentences you never notice — is neither.

The same reasoning splits the reformat transforms: rearranging a table is arithmetic and runs
locally with no model involved, while turning prose into a list is a judgement call and gets a
preview you approve.
