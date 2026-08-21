# Retrieval augmented generation

RAG answers a question by first retrieving relevant material and then asking a language model to answer *using that material*. The retrieval step is what keeps the answer tied to something real.

The order matters. A model asked a question cold will produce a fluent answer from its training data; the same model handed five of your notes will answer from those notes and tell you which ones it used.

Two failure modes are worth naming:

- **Bad retrieval, good prose.** The answer reads well and cites the wrong notes. This is why the retrieved set should be visible and editable, not hidden behind the answer.
- **Context overflow.** Feeding everything is not better than feeding the right five things — see [[Chunking strategies]].

Related: [[Semantic search]], [[Local language models]].
