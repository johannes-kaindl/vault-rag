# Chunking strategies

Long notes have to be split before embedding, because one vector cannot represent five unrelated sections. How you split decides what retrieval can find.

Splitting on headings works well for notes, because a heading is already an author's claim that what follows belongs together. Fixed-size windows work better for prose without structure, at the cost of cutting mid-thought.

Whatever the split, strip frontmatter first — metadata blocks are near-identical across notes and pull unrelated notes toward each other.

For note-level retrieval you then aggregate the chunk vectors back into one vector per note. Mean aggregation is the boring, reliable choice.

Related: [[Vector embeddings]].
