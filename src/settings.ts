import { App, PluginSettingTab, Setting } from "obsidian";

export interface VaultRagSettings {
  k: number;
  minSim: number;
  indexDir: string;
  exclude: string[];
  embeddingEndpoint: string;
  embeddingModel: string;
  showStatusBar: boolean;
}

export const DEFAULT_SETTINGS: VaultRagSettings = {
  k: 20,
  minSim: 0.3,
  indexDir: "_vaultrag",
  exclude: ["Templates/", "Archive/", ".trash/"],
  embeddingEndpoint: "http://localhost:11434",
  embeddingModel: "qwen3-embedding:8b",
  showStatusBar: false,
};

export class VaultRagSettingTab extends PluginSettingTab {
  private refreshInterval: ReturnType<typeof window.setInterval> | null = null;

  constructor(app: App, private plugin: any) { super(app, plugin); }

  hide(): void {
    if (this.refreshInterval !== null) {
      window.clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    super.hide();
  }

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

    // Fortschritts-Sektion
    containerEl.createEl("h3", { text: "Embedding-Fortschritt" });

    const progressStatusEl = containerEl.createDiv({ cls: "vault-rag-progress-status" });
    const progressEmbeddedEl = containerEl.createDiv({ cls: "vault-rag-progress-embedded" });
    const progressPendingEl = containerEl.createDiv({ cls: "vault-rag-progress-pending" });

    const updateProgress = () => {
      const p = this.plugin.embeddingProgress as { isEmbedding: boolean; embeddedNotes: number; pendingNotes: number } | undefined;
      if (!p) return;
      progressStatusEl.setText(p.isEmbedding ? "↻ Embedding läuft…" : "● Bereit");
      progressEmbeddedEl.setText(`Eingebettet: ${p.embeddedNotes.toLocaleString("de-DE")} Notizen`);
      progressPendingEl.setText(`Ausstehend: ${p.pendingNotes.toLocaleString("de-DE")} Notizen`);
    };

    updateProgress();
    this.refreshInterval = window.setInterval(updateProgress, 2000);

    new Setting(containerEl)
      .setName("Fortschritt in Statusleiste")
      .setDesc("Zeigt Embedding-Status in der unteren Obsidian-Leiste")
      .addToggle(t =>
        t.setValue(this.plugin.settings.showStatusBar).onChange(async (v: boolean) => {
          this.plugin.settings.showStatusBar = v;
          await this.plugin.saveSettings();
          (this.plugin.setStatusBarVisible as ((v: boolean) => void) | undefined)?.(v);
        }));

    // Status-Badge (readonly)
    const statusEl = containerEl.createDiv({ cls: "vault-rag-status" });
    statusEl.setText("Status: prüfe…");
    this.plugin.embedder?.ping().then((ok: boolean) => {
      statusEl.setText(ok ? "● Verbunden" : "○ Offline");
    });
  }
}
