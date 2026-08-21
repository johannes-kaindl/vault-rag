# Cosine similarity

Cosine similarity measures the angle between two vectors, ignoring their length. For normalized vectors it is just the dot product — a multiply and an add per dimension.

That cheapness is why on-device retrieval is practical. Comparing one query against several thousand notes is a few million floating-point operations: milliseconds, no server, no daemon, no network.

Values run from -1 to 1, but in practice embedding models cluster everything into a narrow positive band. The absolute number means little; the *ranking* is what matters, and a threshold is best chosen by looking at results rather than by theory.

Related: [[Vector embeddings]], [[Semantic search]].
