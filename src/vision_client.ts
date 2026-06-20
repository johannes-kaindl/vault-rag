export class VisionClient {
  constructor(private endpoint: string, private model: string) {}

  /** Multimodaler /v1/chat/completions-Call: Bild als image_url-Data-URL, non-streaming. */
  async transcribe(dataUrl: string, prompt: string, signal?: AbortSignal): Promise<string> {
    const res = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }],
        stream: false,
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Vision HTTP ${res.status}`);
    const j = await res.json() as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? "";
  }
}
