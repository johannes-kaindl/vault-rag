import { App, PluginSettingTab, Setting } from "obsidian";
import { ChatClient } from "./chat_client";
import { resolveCapabilities } from "./capabilities";
import { reasoningHappened, isAlwaysOnThinker } from "./reasoning";

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
  suppressThinking: boolean;
  enterSends: boolean;
}

export const DEFAULT_SYSTEM_PROMPT =
  "Du beantwortest Fragen gegroundet in den bereitgestellten Notizen des Nutzers. " +
  "Wenn die Antwort nicht aus ihnen hervorgeht, sag das offen. Antworte knapp und auf Deutsch.";

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
  suppressThinking: false,
  enterSends: true,
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

    // ── Helpers: Status-Dot ───────────────────────────────────────────
    const statusDot = (setting: Setting): HTMLElement => {
      const dot = setting.controlEl.createSpan({ cls: "vault-rag-status-dot" });
      dot.setText("·");
      return dot;
    };
    const showPing = (dot: HTMLElement, ok: boolean): void => {
      dot.toggleClass("is-ok", ok);
      dot.toggleClass("is-error", !ok);
      dot.setText(ok ? "● verbunden" : "○ offline");
    };

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

    const embEndpointSetting = new Setting(containerEl)
      .setName("Embedding Endpoint")
      .setDesc("Ollama- oder MLX-Server-URL — Desktop oder VPN-erreichbar")
      .addText(t =>
        t.setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.embeddingEndpoint)
          .onChange(async (v: string) => {
            this.plugin.settings.embeddingEndpoint = v.trim();
            await this.plugin.saveSettings();
            this.plugin.reconnectEmbedder?.();
          }))
      .addButton(b => b.setButtonText("Testen").onClick(async () => {
        b.setDisabled(true);
        const ok = await this.plugin.embedder?.ping();
        showPing(embDot, !!ok);
        b.setDisabled(false);
      }));
    const embDot = statusDot(embEndpointSetting);

    const embModelSetting = new Setting(containerEl)
      .setName("Embedding-Modell")
      .setDesc("Modellname wie auf dem Endpoint verfügbar");
    void this.plugin.embedder?.listModels().then((models: string[]) => {
      const cur = this.plugin.settings.embeddingModel;
      if (models.length) {
        const list = models.includes(cur) ? models : [cur, ...models];
        embModelSetting.addDropdown(d => {
          list.forEach((m: string) => d.addOption(m, m));
          d.setValue(cur).onChange(async (v: string) => {
            this.plugin.settings.embeddingModel = v;
            await this.plugin.saveSettings();
            this.plugin.reconnectEmbedder?.();
          });
        });
      } else {
        embModelSetting.addText(t =>
          t.setPlaceholder("qwen3-embedding:8b").setValue(cur).onChange(async (v: string) => {
            this.plugin.settings.embeddingModel = v.trim();
            await this.plugin.saveSettings();
            this.plugin.reconnectEmbedder?.();
          }));
        embModelSetting.addButton(b => b.setButtonText("Modelle laden").onClick(() => this.display()));
      }
    });

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

    const chatEndpointSetting = new Setting(containerEl)
      .setName("Chat Endpoint")
      .setDesc("OpenAI-kompatibler LLM-Server (MLX/LM-Studio) — getrennt vom Embedding-Endpoint")
      .addText(t =>
        t.setPlaceholder("http://localhost:8080")
          .setValue(this.plugin.settings.chatEndpoint)
          .onChange(async (v: string) => {
            this.plugin.settings.chatEndpoint = v.trim();
            await this.plugin.saveSettings();
            this.plugin.reconnectChat?.();
          }))
      .addButton(b => b.setButtonText("Testen").onClick(async () => {
        b.setDisabled(true);
        const ok = await this.plugin.chatClient?.ping();
        showPing(chatDot, !!ok);
        b.setDisabled(false);
      }));
    const chatDot = statusDot(chatEndpointSetting);

    // ── Capability-Helpers ────────────────────────────────────────────
    const capLabel = (c: { vision: string; thinking: { support: string; confidence: string } }): string => {
      const parts: string[] = [];
      if (c.vision !== "no") parts.push(c.vision === "confirmed" ? "👁 Vision" : "👁 Vision?");
      if (c.thinking.support !== "none") {
        const t = c.thinking.support === "always" ? "💭 Thinking (immer an)" : "💭 Thinking";
        parts.push(c.thinking.confidence === "confirmed" ? t : t + "?");
      }
      return parts.length ? parts.join(" · ") : "keine besonderen Fähigkeiten erkannt";
    };

    const modelSetting = new Setting(containerEl)
      .setName("Chat Modell")
      .setDesc("Modellname wie auf dem Chat-Endpoint verfügbar");
    const infoSetting = new Setting(containerEl)
      .setName("Modell-Details")
      .setDesc("…");
    const capSetting = new Setting(containerEl)
      .setName("Fähigkeiten")
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

    const showCaps = (model: string): void => {
      void this.plugin.chatClient?.fetchCapabilities(model).then((meta: Parameters<typeof resolveCapabilities>[0]) => {
        const caps = resolveCapabilities(meta, model, {});
        capSetting.setDesc(capLabel(caps));
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
            showInfo(v);
            showCaps(v);
          });
        });
      } else {
        modelSetting.setDesc('Server offline — Modellname eintippen, dann „Modelle laden“');
        modelSetting.addText(t =>
          t.setPlaceholder("qwen3").setValue(this.plugin.settings.chatModel)
            .onChange(async (v: string) => {
              this.plugin.settings.chatModel = v.trim();
              await this.plugin.saveSettings();
              this.plugin.reconnectChat?.();
            }));
        modelSetting.addButton(b => b.setButtonText("Modelle laden").onClick(() => this.display()));
      }
      showInfo(this.plugin.settings.chatModel);
      showCaps(this.plugin.settings.chatModel);
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
      .addTextArea(t => {
        t.setValue(this.plugin.settings.chatSystemPrompt)
          .onChange(async (v: string) => {
            this.plugin.settings.chatSystemPrompt = v;
            await this.plugin.saveSettings();
          });
        t.inputEl.rows = 8;
        t.inputEl.addClass("vault-rag-prompt-textarea");
      });

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

    new Setting(containerEl)
      .setName("Thinking unterdrücken")
      .setDesc("Standard für neue Chats. Sendet Suppress-Hints (reasoning_effort/enable_thinking). Pro Chat im Panel umschaltbar.")
      .addToggle(t =>
        t.setValue(this.plugin.settings.suppressThinking).onChange(async (v: boolean) => {
          this.plugin.settings.suppressThinking = v;
          await this.plugin.saveSettings();
        }));

    const suppressTest = new Setting(containerEl)
      .setName("Suppress testen")
      .setDesc("Prüft, ob das aktuelle Modell Thinking wirklich abschaltet.");
    suppressTest.addButton(b => b.setButtonText("Testen").onClick(async () => {
      const model = this.plugin.settings.chatModel;
      if (isAlwaysOnThinker(model)) { suppressTest.setDesc("⚠ Dieses Modell denkt immer (nur low/medium/high)."); return; }
      b.setDisabled(true);
      suppressTest.setDesc("teste…");
      try {
        const res = await (this.plugin.chatClient as ChatClient).stream(
          [{ role: "user", content: "Antworte in genau einem Wort: Hallo." }],
          () => {}, () => {}, undefined, { model, suppressThinking: true });
        const happened = reasoningHappened(res.content, res.reasoning);
        suppressTest.setDesc(happened ? '⚠ Modell denkt trotz „aus“.' : "✓ wird unterdrückt.");
      } catch {
        suppressTest.setDesc("○ Endpoint nicht erreichbar.");
      } finally { b.setDisabled(false); }
    }));

    new Setting(containerEl)
      .setName("Enter sendet")
      .setDesc("An: Enter sendet, Shift+Enter macht eine neue Zeile. Aus: umgekehrt.")
      .addToggle(t =>
        t.setValue(this.plugin.settings.enterSends).onChange(async (v: boolean) => {
          this.plugin.settings.enterSends = v;
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
