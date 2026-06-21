import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
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

    // Verbindungstest meldet per Notice (kein nachgestelltes Status-Element in der controlEl —
    // das bricht sonst die einheitliche rechte Kante; siehe _docs PROF-OBS-06).
    const testEndpoint = async (b: { setButtonText: (t: string) => unknown; setDisabled: (d: boolean) => unknown }, label: string, ping?: () => Promise<boolean>): Promise<void> => {
      b.setButtonText("Teste…"); b.setDisabled(true);
      const ok = await ping?.();
      new Notice(ok ? `${label} verbunden` : `${label} offline`);
      b.setButtonText("Testen"); b.setDisabled(false);
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
    new Setting(containerEl).setName("Live-Embedding").setHeading();

    new Setting(containerEl)
      .setName("Embedding-Endpoint")
      .setDesc("Ollama- oder MLX-Server-URL — Desktop oder VPN-erreichbar")
      .addText(t =>
        t.setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.embeddingEndpoint)
          .onChange(async (v: string) => {
            this.plugin.settings.embeddingEndpoint = v.trim();
            await this.plugin.saveSettings();
            this.plugin.reconnectEmbedder?.();
          }))
      .addButton(b => b.setButtonText("Testen").onClick(() => testEndpoint(b, "Embedding-Endpoint", () => this.plugin.embedder?.ping())));

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

    new Setting(containerEl)
      .setName("Chat-Endpoint")
      .setDesc("OpenAI-kompatibler LLM-Server (MLX/LM-Studio) — getrennt vom Embedding-Endpoint")
      .addText(t =>
        t.setPlaceholder("http://localhost:8080")
          .setValue(this.plugin.settings.chatEndpoint)
          .onChange(async (v: string) => {
            this.plugin.settings.chatEndpoint = v.trim();
            await this.plugin.saveSettings();
            this.plugin.reconnectChat?.();
          }))
      .addButton(b => b.setButtonText("Testen").onClick(() => testEndpoint(b, "Chat-Endpoint", () => this.plugin.chatClient?.ping())));

    // ── Capability-Helpers (Lucide-Icons statt Emoji) ─────────────────
    type Caps = { vision: string; thinking: { support: string; confidence: string } };
    const renderCaps = (setting: Setting, c: Caps): void => {
      const el = setting.controlEl; el.empty();
      const chip = (icon: string, text: string, dim: boolean): void => {
        const span = el.createSpan({ cls: dim ? "vault-rag-cap is-dim" : "vault-rag-cap" });
        setIcon(span.createSpan({ cls: "vault-rag-cap-icon" }), icon);
        span.createSpan({ text });
      };
      let any = false;
      if (c.vision !== "no") { chip("eye", c.vision === "confirmed" ? "Vision" : "Vision?", c.vision !== "confirmed"); any = true; }
      if (c.thinking.support !== "none") {
        const t = c.thinking.support === "always" ? "Thinking (immer an)" : "Thinking";
        chip("brain", c.thinking.confidence === "confirmed" ? t : t + "?", c.thinking.confidence !== "confirmed");
        any = true;
      }
      if (!any) el.setText("keine besonderen Fähigkeiten erkannt");
    };
    // zuletzt aufgelöste Caps — der Suppress-Test (unten) hebt Thinking hier live an.
    let lastCaps: Caps = { vision: "no", thinking: { support: "none", confidence: "no" } };
    // wird im Budget-Slider-Block gesetzt (Modell-Fenster koppelt die Obergrenze).
    let updateBudgetMax: (maxChars: number) => void = () => {};

    const modelSetting = new Setting(containerEl)
      .setName("Chat-Modell")
      .setDesc("Modellname wie auf dem Chat-Endpoint verfügbar");
    const infoSetting = new Setting(containerEl).setName("Modelldetails");
    const infoValue = infoSetting.controlEl.createSpan({ cls: "vault-rag-info-value", text: "…" });
    const capSetting = new Setting(containerEl).setName("Fähigkeiten");

    const showInfo = (model: string): void => {
      void this.plugin.chatClient?.modelInfo(model).then((info: { contextLength?: number; quantization?: string; state?: string } | null) => {
        if (info) {
          const ctx = info.contextLength ? `max Context ${info.contextLength.toLocaleString("de-DE")}` : "";
          infoValue.setText([ctx, info.quantization, info.state].filter(Boolean).join(" · ") || "geladen");
          // Budget-Obergrenze ans Modell-Fenster koppeln (~4 Zeichen/Token).
          if (info.contextLength) updateBudgetMax(info.contextLength * 4);
        } else {
          infoValue.setText("keine Details (braucht LM Studios /api/v0/models)");
        }
      });
    };

    const showCaps = (model: string): void => {
      void this.plugin.chatClient?.fetchCapabilities(model).then((meta: Parameters<typeof resolveCapabilities>[0]) => {
        lastCaps = resolveCapabilities(meta, model, {});
        renderCaps(capSetting, lastCaps);
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
      .setDesc("Maximale Gesamtlänge des Notiz-Kontexts (anteilig verteilt). Obergrenze richtet sich nach dem Modell-Fenster.")
      .addSlider(s => {
        s.setLimits(2000, 32000, 1000)
          .setValue(this.plugin.settings.contextCharBudget)
          .setDynamicTooltip()
          .onChange(async (v: number) => {
            this.plugin.settings.contextCharBudget = v;
            budgetSetting.setName(`Kontext-Budget: ${v.toLocaleString("de-DE")} Zeichen`);
            await this.plugin.saveSettings();
          });
        // Sobald das Modell-Fenster bekannt ist (showInfo): Slider-Max daran koppeln + Wert klemmen.
        updateBudgetMax = (maxChars: number): void => {
          const max = Math.max(8000, Math.round(maxChars / 1000) * 1000);
          s.setLimits(2000, max, 1000);
          const val = Math.min(this.plugin.settings.contextCharBudget, max);
          s.setValue(val);
          budgetSetting.setName(`Kontext-Budget: ${val.toLocaleString("de-DE")} / max ~${max.toLocaleString("de-DE")} Zeichen`);
          if (val !== this.plugin.settings.contextCharBudget) {
            this.plugin.settings.contextCharBudget = val;   // nur bei echter Klemmung schreiben
            void this.plugin.saveSettings();
          }
        };
      });

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
      .setDesc("Standard für neue Chats. Sendet Suppress-Hints (reasoning_effort/enable_thinking). Pro Chat im Panel umschaltbar. „Testen“ prüft, ob das Modell wirklich abschaltet.")
      .addToggle(t =>
        t.setValue(this.plugin.settings.suppressThinking).onChange(async (v: boolean) => {
          this.plugin.settings.suppressThinking = v;
          await this.plugin.saveSettings();
        }))
      .addButton(b => b.setButtonText("Testen").onClick(async () => {
        const model = this.plugin.settings.chatModel;
        if (isAlwaysOnThinker(model)) { new Notice("Dieses Modell denkt immer (nur low/medium/high)."); return; }
        b.setButtonText("Teste…"); b.setDisabled(true);
        try {
          const res = await (this.plugin.chatClient as ChatClient).stream(
            [{ role: "user", content: "Antworte in genau einem Wort: Hallo." }],
            () => {}, () => {}, undefined, { model, suppressThinking: true });
          const happened = reasoningHappened(res.content, res.reasoning);
          new Notice(happened ? "Modell denkt trotz „aus“" : "Thinking wird unterdrückt");
          if (happened) {
            // Live-Nachweis, dass das Modell denkt → Fähigkeiten-Zeile hochstufen.
            lastCaps = { ...lastCaps, thinking: { support: "always", confidence: "confirmed" } };
            renderCaps(capSetting, lastCaps);
          }
        } catch {
          new Notice("Chat-Endpoint nicht erreichbar");
        } finally { b.setButtonText("Testen"); b.setDisabled(false); }
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
