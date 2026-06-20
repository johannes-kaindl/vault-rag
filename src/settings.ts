import { App, PluginSettingTab, Setting } from "obsidian";
import { ChatClient } from "./chat_client";

export interface VaultRagSettings {
  k: number;
  minSim: number;
  indexDir: string;
  exclude: string[];
  embeddingEndpoint: string;
  embeddingModel: string;
  showStatusBar: boolean;
  debounceMs: number;
  chatEndpoint: string;
  chatModel: string;
  chatK: number;
  contextCharBudget: number;
  chatTemperature: number;
  chatSystemPrompt: string;
  chatInputPosition: "bottom" | "top";
  visionEndpoint: string;
  visionModel: string;
  visionPrompt: string;
}

export const DEFAULT_SYSTEM_PROMPT =
  "Du beantwortest Fragen gegroundet in den bereitgestellten Notizen des Nutzers. " +
  "Wenn die Antwort nicht aus ihnen hervorgeht, sag das offen. Antworte knapp und auf Deutsch.";

export const DEFAULT_VISION_PROMPT =
  "Transkribiere den Text im Bild exakt nach Markdown. Erhalte die Struktur: Überschriften, Absätze, " +
  "**Hervorhebungen**, Listen und Tabellen. Gib nur das Markdown aus, keine Kommentare.";

export const DEFAULT_SETTINGS: VaultRagSettings = {
  k: 20,
  minSim: 0.3,
  indexDir: "_vaultrag",
  exclude: ["Templates/", "Archive/"],
  embeddingEndpoint: "http://localhost:11434",
  embeddingModel: "qwen3-embedding:8b",
  showStatusBar: false,
  debounceMs: 3000,
  chatEndpoint: "http://localhost:8080",
  chatModel: "qwen3",
  chatK: 5,
  contextCharBudget: 12000,
  chatTemperature: 0.7,
  chatSystemPrompt: DEFAULT_SYSTEM_PROMPT,
  chatInputPosition: "bottom",
  visionEndpoint: "http://localhost:8080",
  visionModel: "",
  visionPrompt: DEFAULT_VISION_PROMPT,
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
      .setDesc("Kommagetrennte Pfade, die nicht eingebettet werden (z.B. Templates/, Archive/). Versteckte Pfade wie .obsidian/ und .trash/ sind immer automatisch ausgeschlossen.")
      .addText(t => t
        .setPlaceholder("Templates/, Archive/")
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

    // ── Chat ──────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Chat").setHeading();

    let chatConnSetting: Setting;
    const pingChat = (): void => {
      this.plugin.chatClient?.ping().then((ok: boolean) => {
        chatConnSetting?.setDesc(ok ? "● Verbunden" : "○ Offline — Endpoint/Modell prüfen (LM Studio: http://localhost:1234)");
      });
    };

    new Setting(containerEl)
      .setName("Chat Endpoint")
      .setDesc("OpenAI-kompatibler LLM-Server (MLX/LM-Studio) — getrennt vom Embedding-Endpoint")
      .addText(t =>
        t.setPlaceholder("http://localhost:8080")
          .setValue(this.plugin.settings.chatEndpoint)
          .onChange(async (v: string) => {
            this.plugin.settings.chatEndpoint = v.trim();
            await this.plugin.saveSettings();
            this.plugin.reconnectChat?.();
            pingChat();
          }));

    const modelSetting = new Setting(containerEl)
      .setName("Chat Modell")
      .setDesc("Modellname wie auf dem Chat-Endpoint verfügbar");
    const infoSetting = new Setting(containerEl)
      .setName("Modell-Details")
      .setDesc("…");
    const showInfo = (model: string): void => {
      void this.plugin.chatClient?.modelInfo(model).then((info: { contextLength?: number; quantization?: string; state?: string } | null) => {
        if (info) {
          const ctx = info.contextLength ? `Context ${info.contextLength.toLocaleString("de-DE")}` : "";
          infoSetting.setDesc([ctx, info.quantization, info.state].filter(Boolean).join(" · ") || "geladen");
        } else {
          infoSetting.setDesc("keine Details (braucht LM Studios /api/v0/models)");
        }
      });
    };
    void this.plugin.chatClient?.listModels().then((models: string[]) => {
      if (models.length) {
        const cur = this.plugin.settings.chatModel;
        const list = models.includes(cur) ? models : [cur, ...models];
        modelSetting.addDropdown(d => {
          list.forEach((m: string) => d.addOption(m, m));
          d.setValue(cur).onChange(async (v: string) => {
            this.plugin.settings.chatModel = v;
            await this.plugin.saveSettings();
            this.plugin.reconnectChat?.();
            pingChat();
            showInfo(v);
          });
        });
      } else {
        modelSetting.setDesc("Server offline — Modellname eintippen, dann „Modelle laden“");
        modelSetting.addText(t =>
          t.setPlaceholder("qwen3").setValue(this.plugin.settings.chatModel)
            .onChange(async (v: string) => {
              this.plugin.settings.chatModel = v.trim();
              await this.plugin.saveSettings();
              this.plugin.reconnectChat?.();
              pingChat();
            }));
        modelSetting.addButton(b => b.setButtonText("Modelle laden").onClick(() => this.display()));
      }
      showInfo(this.plugin.settings.chatModel);
    });

    let chatKSetting: Setting;
    chatKSetting = new Setting(containerEl)
      .setName(`Kontext-Notizen: ${this.plugin.settings.chatK}`)
      .setDesc("Wie viele Notizen als Kontext in den Chat gehen (Auto-RAG)")
      .addSlider(s => s
        .setLimits(1, 20, 1)
        .setValue(this.plugin.settings.chatK)
        .setDynamicTooltip()
        .onChange(async (v: number) => {
          this.plugin.settings.chatK = v;
          chatKSetting.setName(`Kontext-Notizen: ${v}`);
          await this.plugin.saveSettings();
        }));

    let budgetSetting: Setting;
    budgetSetting = new Setting(containerEl)
      .setName(`Kontext-Budget: ${this.plugin.settings.contextCharBudget.toLocaleString("de-DE")} Zeichen`)
      .setDesc("Maximale Gesamtlänge des Kontexts (wird anteilig auf die Notizen verteilt)")
      .addSlider(s => s
        .setLimits(2000, 32000, 1000)
        .setValue(this.plugin.settings.contextCharBudget)
        .setDynamicTooltip()
        .onChange(async (v: number) => {
          this.plugin.settings.contextCharBudget = v;
          budgetSetting.setName(`Kontext-Budget: ${v.toLocaleString("de-DE")} Zeichen`);
          await this.plugin.saveSettings();
        }));

    let tempSetting: Setting;
    tempSetting = new Setting(containerEl)
      .setName(`Temperatur: ${this.plugin.settings.chatTemperature}`)
      .setDesc("Kreativität vs. Bestimmtheit (0 = deterministisch, höher = kreativer)")
      .addSlider(s => s
        .setLimits(0, 2, 0.1)
        .setValue(this.plugin.settings.chatTemperature)
        .setDynamicTooltip()
        .onChange(async (v: number) => {
          this.plugin.settings.chatTemperature = v;
          tempSetting.setName(`Temperatur: ${v}`);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("System-Prompt")
      .setDesc("Grundanweisung an das Modell. Der Notiz-Kontext wird automatisch angehängt.")
      .addTextArea(t => t
        .setValue(this.plugin.settings.chatSystemPrompt)
        .onChange(async (v: string) => {
          this.plugin.settings.chatSystemPrompt = v;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Eingabe-Position")
      .setDesc("Wo die Chat-Eingabe sitzt (greift beim nächsten Öffnen des Panels)")
      .addDropdown(d => d
        .addOption("bottom", "Unten")
        .addOption("top", "Oben")
        .setValue(this.plugin.settings.chatInputPosition)
        .onChange(async (v: string) => {
          this.plugin.settings.chatInputPosition = v as "bottom" | "top";
          await this.plugin.saveSettings();
        }));

    chatConnSetting = new Setting(containerEl)
      .setName("Chat-Verbindung")
      .setDesc("prüfe…");
    pingChat();

    // ── Vision (IMG→MD) ───────────────────────────────────────────────
    new Setting(containerEl).setName("Vision (IMG→MD)").setHeading();

    new Setting(containerEl)
      .setName("Vision Endpoint")
      .setDesc("OpenAI-kompatibler Server mit Vision-Modell (z.B. LM Studio)")
      .addText(t => t.setPlaceholder("http://localhost:8080").setValue(this.plugin.settings.visionEndpoint)
        .onChange(async (v: string) => { this.plugin.settings.visionEndpoint = v.trim(); await this.plugin.saveSettings(); this.plugin.reconnectVision?.(); }));

    const visModelSetting = new Setting(containerEl).setName("Vision Modell").setDesc("Vision-fähiges Modell (Qwen2-VL, Llama-3.2-Vision …)");
    void new ChatClient(this.plugin.settings.visionEndpoint, "").listModels().then((models: string[]) => {
      const cur = this.plugin.settings.visionModel;
      if (models.length) {
        const list = cur && !models.includes(cur) ? [cur, ...models] : models;
        visModelSetting.addDropdown(d => {
          list.forEach((m: string) => d.addOption(m, m));
          if (cur) d.setValue(cur);
          d.onChange(async (v: string) => { this.plugin.settings.visionModel = v; await this.plugin.saveSettings(); this.plugin.reconnectVision?.(); });
        });
      } else {
        visModelSetting.addText(t => t.setPlaceholder("qwen2-vl").setValue(cur)
          .onChange(async (v: string) => { this.plugin.settings.visionModel = v.trim(); await this.plugin.saveSettings(); this.plugin.reconnectVision?.(); }));
        visModelSetting.addButton(b => b.setButtonText("Modelle laden").onClick(() => this.display()));
      }
    });

    new Setting(containerEl)
      .setName("Transkriptions-Prompt")
      .setDesc("Anweisung an das Vision-Modell. Der Bild-Inhalt wird mitgeschickt.")
      .addTextArea(t => t.setValue(this.plugin.settings.visionPrompt)
        .onChange(async (v: string) => { this.plugin.settings.visionPrompt = v; await this.plugin.saveSettings(); }));

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
