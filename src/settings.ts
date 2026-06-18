import { App, PluginSettingTab, Setting } from "obsidian";

export interface VaultRagSettings {
  k: number;
  minSim: number;
  indexDir: string;
  exclude: string[];
  embeddingEndpoint: string;
  embeddingModel: string;
  showStatusBar: boolean;
  debounceMs: number;
}

export const DEFAULT_SETTINGS: VaultRagSettings = {
  k: 20,
  minSim: 0.3,
  indexDir: "_vaultrag",
  exclude: ["Templates/", "Archive/", ".trash/"],
  embeddingEndpoint: "http://localhost:11434",
  embeddingModel: "qwen3-embedding:8b",
  showStatusBar: false,
  debounceMs: 3000,
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
    // altes Interval stoppen (falls display() mehrfach aufgerufen wird)
    if (this.refreshInterval !== null) {
      window.clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    // ── Suche ─────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Suche").setHeading();

    let kSetting: Setting;
    kSetting = new Setting(containerEl)
      .setName(`Anzahl verwandter Notizen: ${this.plugin.settings.k}`)
      .setDesc("Wie viele ähnliche Notizen im Panel angezeigt werden (5–50)")
      .addSlider(s => s
        .setLimits(5, 50, 1)
        .setValue(this.plugin.settings.k)
        .setDynamicTooltip()
        .onChange(async (v: number) => {
          this.plugin.settings.k = v;
          kSetting.setName(`Anzahl verwandter Notizen: ${v}`);
          await this.plugin.saveSettings();
          this.plugin.refresh();
        }));

    let simSetting: Setting;
    simSetting = new Setting(containerEl)
      .setName(`Mindest-Ähnlichkeit: ${Math.round(this.plugin.settings.minSim * 100)} %`)
      .setDesc("Notizen unterhalb dieser Schwelle werden ausgeblendet — niedriger = mehr Treffer, unschärfer")
      .addSlider(s => s
        .setLimits(0, 0.9, 0.05)
        .setValue(this.plugin.settings.minSim)
        .setDynamicTooltip()
        .onChange(async (v: number) => {
          this.plugin.settings.minSim = v;
          simSetting.setName(`Mindest-Ähnlichkeit: ${Math.round(v * 100)} %`);
          await this.plugin.saveSettings();
          this.plugin.refresh();
        }));

    new Setting(containerEl)
      .setName("Ausschluss-Pfade")
      .setDesc("Pfade, die nicht eingebettet werden — kommagetrennt, z.B. Templates/, Archive/, .trash/")
      .addText(t => t
        .setPlaceholder("Templates/, Archive/, .trash/")
        .setValue(this.plugin.settings.exclude.join(", "))
        .onChange(async (v: string) => {
          this.plugin.settings.exclude = v.split(",").map((s: string) => s.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        }));

    // ── Live Embedding ─────────────────────────────────────────────────
    new Setting(containerEl).setName("Live Embedding").setHeading();

    new Setting(containerEl)
      .setName("Embedding Endpoint")
      .setDesc("Ollama- oder MLX-Server-URL — Desktop oder VPN-erreichbar")
      .addText(t =>
        t.setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.embeddingEndpoint)
          .onChange(async (v: string) => {
            this.plugin.settings.embeddingEndpoint = v.trim();
            await this.plugin.saveSettings();
            this.plugin.reconnectEmbedder?.();
          }));

    new Setting(containerEl)
      .setName("Embedding Modell")
      .setDesc("Modellname wie auf dem Endpoint verfügbar")
      .addText(t =>
        t.setPlaceholder("qwen3-embedding:8b")
          .setValue(this.plugin.settings.embeddingModel)
          .onChange(async (v: string) => {
            this.plugin.settings.embeddingModel = v.trim();
            await this.plugin.saveSettings();
            this.plugin.reconnectEmbedder?.();
          }));

    let debounceSetting: Setting;
    debounceSetting = new Setting(containerEl)
      .setName(`Debounce: ${this.plugin.settings.debounceMs / 1000} s`)
      .setDesc("Wartezeit nach dem letzten Speichern, bevor neu eingebettet wird")
      .addSlider(s => s
        .setLimits(500, 10000, 500)
        .setValue(this.plugin.settings.debounceMs)
        .setDynamicTooltip()
        .onChange(async (v: number) => {
          this.plugin.settings.debounceMs = v;
          debounceSetting.setName(`Debounce: ${v / 1000} s`);
          await this.plugin.saveSettings();
        }));

    // ── Status ────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Status").setHeading();

    let progressSetting: Setting;
    progressSetting = new Setting(containerEl)
      .setName("● Bereit")
      .setDesc("Lade…");

    const updateProgress = () => {
      const p = this.plugin.embeddingProgress as { isEmbedding: boolean; embeddedNotes: number; pendingNotes: number } | undefined;
      if (!p) return;
      progressSetting.setName(p.isEmbedding ? "↻ Embedding läuft…" : "● Bereit");
      progressSetting.setDesc(`${p.embeddedNotes.toLocaleString("de-DE")} eingebettet · ${p.pendingNotes.toLocaleString("de-DE")} ausstehend`);
    };
    updateProgress();
    this.refreshInterval = window.setInterval(updateProgress, 2000);

    const connSetting = new Setting(containerEl)
      .setName("Verbindung")
      .setDesc("prüfe…");
    this.plugin.embedder?.ping().then((ok: boolean) => {
      connSetting.setDesc(ok ? "● Verbunden" : "○ Offline — Embeddings werden gespeichert und beim nächsten Connect nachgeholt");
    });

    new Setting(containerEl)
      .setName("Fortschritt in Statusleiste")
      .setDesc("Zeigt Embedding-Status in der unteren Obsidian-Leiste")
      .addToggle(t =>
        t.setValue(this.plugin.settings.showStatusBar).onChange(async (v: boolean) => {
          this.plugin.settings.showStatusBar = v;
          await this.plugin.saveSettings();
          (this.plugin.setStatusBarVisible as ((v: boolean) => void) | undefined)?.(v);
        }));
  }
}
