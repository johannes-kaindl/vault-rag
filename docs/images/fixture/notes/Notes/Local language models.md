# Local language models

Running a model on your own hardware changes the trade-offs rather than removing them. You give up peak quality and gain the guarantee that the text never leaves the machine.

For retrieval work the split is convenient: embedding models are small and fast, so indexing a vault locally is comfortable even on a laptop. Chat models are the expensive half.

Practical notes:

- An OpenAI-compatible server is the common denominator; most local runtimes speak it.
- Streaming from inside a desktop app is a browser request, so the server has to allow the app's origin. A server that answers a connection test can still refuse a streamed request.
- Reasoning models emit their thinking as a separate channel. Showing it is useful; sending it back into the conversation is not.

Related: [[Retrieval augmented generation]].
