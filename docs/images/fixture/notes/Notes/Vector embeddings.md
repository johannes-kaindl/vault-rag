# Vector embeddings

An embedding maps a piece of text to a list of numbers, arranged so that texts with similar meaning land near each other. "Where did I write about forgetting curves?" and a note titled [[Spaced repetition]] end up close together without sharing a single word.

Two properties matter in practice:

- **Dimension.** More numbers means finer distinctions and a bigger index. Matryoshka embeddings let you truncate a long vector to a short one and keep most of the signal — which is how a whole vault fits in a couple of megabytes.
- **Quantization.** Storing each number as one byte instead of four shrinks the index fourfold and costs almost nothing in ranking quality, as long as you renormalize after decoding.

An index is bound to the model that produced it. Vectors from two different models are not comparable, even when they have the same dimension — mixing them degrades ranking silently.

Related: [[Cosine similarity]], [[Chunking strategies]].
