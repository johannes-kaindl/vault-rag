# Semantic search

Semantic search finds notes by meaning rather than by the words you happened to type. You ask "how do I stop forgetting what I read", and it returns [[Spaced repetition]] and [[Reading workflow]] even though neither contains that phrase.

It complements keyword search rather than replacing it. Keyword search is exact and unbeatable when you remember a distinctive term; semantic search is what you need when you only remember the shape of the thought.

The mechanics are simple once an index exists: embed the query with the same model that built the index, then rank every note by [[Cosine similarity]]. For a few thousand notes, brute force is fast enough that no vector database is involved.

Related: [[Vector embeddings]], [[Zettelkasten method]].
