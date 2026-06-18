import { App, PluginSettingTab, Setting } from "obsidian";

export interface VaultRagSettings {
  k: number;
  minSim: number;
  indexDir: string;
  exclude: string[];
  embeddingEndpoint: string;
  embeddingModel: string;
}

export const DEFAULT_SETTINGS: VaultRagSettings = {
  k: 20,
  minSim: 0.3,
  indexDir: "_vaultrag",
  exclude: ["Templates/", "Archive/", ".trash/"],
  embeddingEndpoint: "http://localhost:11434",
  embeddingModel: "qwen3-embedding:8b",
};

export class VaultRagSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: any) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Anzahl Treffer (k)").addSlider(s =>
      s.setLimits(5, 50, 1).setValue(this.plugin.settings.k).onChange(async (v: number) => {
        this.plugin.settings.k = v; await this.plugin.saveSettings(); this.plugin.refresh();
      }));

    new Setting(containerEl).setName("Min. Ähnlichkeit").addSlider(s =>
      s.setLimits(0, 0.9, 0.05).setValue(this.plugin.settings.minSim).onChange(async (v: number) => {
        this.plugin.settings.minSim = v; await this.plugin.saveSettings(); this.plugin.refresh();
      }));

    new Setting(containerEl).setName("Index-Ordner").addText(t =>
      t.setValue(this.plugin.settings.indexDir).onChange(async (v: string) => {
        this.plugin.settings.indexDir = v; await this.plugin.saveSettings(); await this.plugin.loadIndex();
      }));

    new Setting(containerEl).setName("Embedding Endpoint")
      .setDesc("Ollama- oder MLX-Endpoint, z.B. http://localhost:11434")
      .addText(t =>
        t.setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.embeddingEndpoint)
          .onChange(async (v: string) => {
            this.plugin.settings.embeddingEndpoint = v.trim();
            await this.plugin.saveSettings();
            this.plugin.reconnectEmbedder?.();
          }));

    new Setting(containerEl).setName("Embedding Modell")
      .setDesc("Modell-Name wie auf dem Endpoint verfügbar")
      .addText(t =>
        t.setPlaceholder("qwen3-embedding:8b")
          .setValue(this.plugin.settings.embeddingModel)
          .onChange(async (v: string) => {
            this.plugin.settings.embeddingModel = v.trim();
            await this.plugin.saveSettings();
            this.plugin.reconnectEmbedder?.();
          }));

    // Status-Badge (readonly)
    const statusEl = containerEl.createDiv({ cls: "vault-rag-status" });
    statusEl.setText("Status: prüfe…");
    this.plugin.embedder?.ping().then((ok: boolean) => {
      statusEl.setText(ok ? "● Verbunden" : "○ Offline");
    });
  }
}
