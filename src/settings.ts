import { App, ButtonComponent, Notice, Plugin, PluginSettingTab, Setting, setIcon } from "obsidian";
import { ChatClient } from "./chat_client";
import { EmbeddingClient } from "./embedder";
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

type Caps = { vision: string; thinking: { support: string; confidence: string } };

/** Die Plugin-Oberfläche, die der Settings-Tab nutzt — getypt statt `any`. */
export interface VaultRagPluginHost extends Plugin {
  settings: VaultRagSettings;
  embedder: EmbeddingClient;
  chatClient: ChatClient;
  embeddingProgress: { isEmbedding: boolean; embeddedNotes: number; pendingNotes: number };
  saveSettings(): Promise<void>;
  refresh(): void;
  reconnectEmbedder(): void;
  reconnectChat(): void;
  setStatusBarVisible(visible: boolean): void;
}

/**
 * Settings-Tab. Die Zeilen-Logik lebt in `build*`-Methoden, die EINEN `Setting` füllen; `display()`
 * rendert sie flach. Querverweise zwischen Zeilen (Modelldetails↔Budget-Slider, Suppress-Test↔
 * Fähigkeiten) laufen über Render-State-Felder, die `resetRenderState()` pro Render-Zyklus neu setzt.
 */
export class VaultRagSettingTab extends PluginSettingTab {
  private refreshInterval: ReturnType<typeof window.setInterval> | null = null;
  private lastCaps: Caps = { vision: "no", thinking: { support: "none", confidence: "no" } };
  private updateBudgetMax: (maxChars: number) => void = () => {};
  private infoValue: HTMLElement | null = null;
  private capSetting: Setting | null = null;

  constructor(app: App, private plugin: VaultRagPluginHost) { super(app, plugin); }

  hide(): void {
    this.clearInterval();
    super.hide();
  }

  private clearInterval(): void {
    if (this.refreshInterval !== null) { window.clearInterval(this.refreshInterval); this.refreshInterval = null; }
  }

  private resetRenderState(): void {
    // Intervall NUR in buildEmbeddingStatus (clear-then-start) starten + in hide() stoppen —
    // hier nicht anfassen.
    this.lastCaps = { vision: "no", thinking: { support: "none", confidence: "no" } };
    this.updateBudgetMax = () => {};
    this.infoValue = null;
    this.capSetting = null;
  }

  /** Re-Render nach einem Daten-Refresh (z.B. „Modelle laden“). */
  private rerender(): void {
    // display() ist seit 1.13 deprecated, bleibt aber der Render-Pfad für minAppVersion 1.7.2.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    this.display();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.resetRenderState();
    const sec = (name: string): void => { new Setting(containerEl).setName(name).setHeading(); };
    sec("Suche");
    this.buildK(new Setting(containerEl));
    this.buildMinSim(new Setting(containerEl));
    this.buildExclude(new Setting(containerEl));
    sec("Live-Embedding");
    this.buildEmbeddingEndpoint(new Setting(containerEl));
    this.buildEmbeddingModel(new Setting(containerEl));
    this.buildEmbeddingStatus(new Setting(containerEl));
    this.buildDebounce(new Setting(containerEl));
    this.buildStatusBar(new Setting(containerEl));
    sec("Chat");
    this.buildChatEndpoint(new Setting(containerEl));
    this.buildChatModel(new Setting(containerEl));
    this.buildModelDetails(new Setting(containerEl));
    this.buildCaps(new Setting(containerEl));
    this.buildChatK(new Setting(containerEl));
    this.buildBudget(new Setting(containerEl));
    this.buildTemp(new Setting(containerEl));
    this.buildSystemPrompt(new Setting(containerEl));
    this.buildInputPos(new Setting(containerEl));
    this.buildThinking(new Setting(containerEl));
    this.buildEnter(new Setting(containerEl));
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Verbindungstest meldet per Notice — kein nachgestelltes Status-Element in der controlEl
   *  (das bräche die einheitliche rechte Kante; siehe _docs PROF-OBS-06). */
  private async testEndpoint(b: ButtonComponent, label: string, ping?: () => Promise<boolean>): Promise<void> {
    b.setButtonText("Teste…"); b.setDisabled(true);
    const ok = await ping?.();
    new Notice(ok ? `${label} verbunden` : `${label} offline`);
    b.setButtonText("Testen"); b.setDisabled(false);
  }

  /** Capability-Chips (Lucide-Icons) in die controlEl der Fähigkeiten-Zeile. */
  private renderCaps(setting: Setting, c: Caps): void {
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
  }

  private showInfo(model: string): void {
    // Tolerant gegenüber stale .then nach einem update()/display()-Re-Render: resetRenderState()
    // nullt die Felder, die Null-Guards no-oppen dann; bei gleichem Modell ist der Inhalt idempotent.
    void this.plugin.chatClient?.modelInfo(model).then((info: { contextLength?: number; quantization?: string; state?: string } | null) => {
      if (!this.infoValue) return;
      if (info) {
        const ctx = info.contextLength ? `max Context ${info.contextLength.toLocaleString("de-DE")}` : "";
        this.infoValue.setText([ctx, info.quantization, info.state].filter(Boolean).join(" · ") || "geladen");
        // Budget-Obergrenze ans Modell-Fenster koppeln (~4 Zeichen/Token).
        if (info.contextLength) this.updateBudgetMax(info.contextLength * 4);
      } else {
        this.infoValue.setText("keine Details (braucht LM Studios /api/v0/models)");
      }
    });
  }

  private showCaps(model: string): void {
    void this.plugin.chatClient?.fetchCapabilities(model).then((meta: Parameters<typeof resolveCapabilities>[0]) => {
      this.lastCaps = resolveCapabilities(meta, model, {});
      if (this.capSetting) this.renderCaps(this.capSetting, this.lastCaps);
    });
  }

  // ── Builder: Suche ────────────────────────────────────────────────────
  private buildK(s: Setting): void {
    s.setName(`Anzahl verwandter Notizen: ${this.plugin.settings.k}`)
      .setDesc("Wie viele ähnliche Notizen im Panel angezeigt werden (5–50)")
      .addSlider(sl => sl.setLimits(5, 50, 1).setValue(this.plugin.settings.k)        .onChange(async (v: number) => {
          this.plugin.settings.k = v;
          s.setName(`Anzahl verwandter Notizen: ${v}`);
          await this.plugin.saveSettings();
          this.plugin.refresh();
        }));
  }

  private buildMinSim(s: Setting): void {
    s.setName(`Mindest-Ähnlichkeit: ${Math.round(this.plugin.settings.minSim * 100)} %`)
      .setDesc("Notizen unterhalb dieser Schwelle werden ausgeblendet — niedriger = mehr Treffer, unschärfer")
      .addSlider(sl => sl.setLimits(0, 0.9, 0.05).setValue(this.plugin.settings.minSim)        .onChange(async (v: number) => {
          this.plugin.settings.minSim = v;
          s.setName(`Mindest-Ähnlichkeit: ${Math.round(v * 100)} %`);
          await this.plugin.saveSettings();
          this.plugin.refresh();
        }));
  }

  private buildExclude(s: Setting): void {
    s.setName("Ausschluss-Pfade")
      .setDesc("Kommagetrennte Pfade, die nicht eingebettet werden (z.B. Templates/, Archive/). Versteckte Pfade (Konfig-Ordner, Papierkorb) sind immer automatisch ausgeschlossen.")
      .addText(t => t.setPlaceholder("Templates/, Archive/").setValue(this.plugin.settings.exclude.join(", "))
        .onChange(async (v: string) => {
          this.plugin.settings.exclude = v.split(",").map((x: string) => x.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        }));
  }

  // ── Builder: Live-Embedding ───────────────────────────────────────────
  private buildEmbeddingEndpoint(s: Setting): void {
    s.setName("Embedding-Endpoint")
      .setDesc("Ollama- oder MLX-Server-URL — Desktop oder VPN-erreichbar")
      .addText(t => t.setPlaceholder("http://localhost:11434").setValue(this.plugin.settings.embeddingEndpoint)
        .onChange(async (v: string) => {
          this.plugin.settings.embeddingEndpoint = v.trim();
          await this.plugin.saveSettings();
          this.plugin.reconnectEmbedder?.();
        }))
      .addButton(b => b.setButtonText("Testen").onClick(() => this.testEndpoint(b, "Embedding-Endpoint", () => this.plugin.embedder?.ping())));
  }

  private buildEmbeddingModel(s: Setting): void {
    s.setName("Embedding-Modell").setDesc("Modellname wie auf dem Endpoint verfügbar");
    void this.plugin.embedder?.listModels().then((models: string[]) => {
      const cur = this.plugin.settings.embeddingModel;
      if (models.length) {
        const list = models.includes(cur) ? models : [cur, ...models];
        s.addDropdown(d => {
          list.forEach((m: string) => { d.addOption(m, m); });
          d.setValue(cur).onChange((v: string) => {
            this.plugin.settings.embeddingModel = v;
            void this.plugin.saveSettings();
            this.plugin.reconnectEmbedder();
          });
        });
      } else {
        s.addText(t => t.setPlaceholder("qwen3-embedding:8b").setValue(cur).onChange(async (v: string) => {
          this.plugin.settings.embeddingModel = v.trim();
          await this.plugin.saveSettings();
          this.plugin.reconnectEmbedder?.();
        }));
        s.addButton(b => b.setButtonText("Modelle laden").onClick(() => this.rerender()));
      }
    });
  }

  private buildDebounce(s: Setting): void {
    s.setName(`Debounce: ${this.plugin.settings.debounceMs / 1000} s`)
      .setDesc("Wartezeit nach dem letzten Speichern, bevor neu eingebettet wird")
      .addSlider(sl => sl.setLimits(500, 10000, 500).setValue(this.plugin.settings.debounceMs)        .onChange(async (v: number) => {
          this.plugin.settings.debounceMs = v;
          s.setName(`Debounce: ${v / 1000} s`);
          await this.plugin.saveSettings();
        }));
  }

  // ── Builder: Chat ─────────────────────────────────────────────────────
  private buildChatEndpoint(s: Setting): void {
    s.setName("Chat-Endpoint")
      .setDesc("OpenAI-kompatibler LLM-Server (MLX/LM-Studio) — getrennt vom Embedding-Endpoint")
      .addText(t => t.setPlaceholder("http://localhost:8080").setValue(this.plugin.settings.chatEndpoint)
        .onChange(async (v: string) => {
          this.plugin.settings.chatEndpoint = v.trim();
          await this.plugin.saveSettings();
          this.plugin.reconnectChat?.();
        }))
      .addButton(b => b.setButtonText("Testen").onClick(() => this.testEndpoint(b, "Chat-Endpoint", () => this.plugin.chatClient?.ping())));
  }

  private buildChatModel(s: Setting): void {
    s.setName("Chat-Modell").setDesc("Modellname wie auf dem Chat-Endpoint verfügbar");
    void this.plugin.chatClient?.listModels().then((models: string[]) => {
      if (models.length) {
        const cur = this.plugin.settings.chatModel;
        const list = models.includes(cur) ? models : [cur, ...models];
        s.addDropdown(d => {
          list.forEach((m: string) => { d.addOption(m, m); });
          d.setValue(cur).onChange((v: string) => {
            this.plugin.settings.chatModel = v;
            void this.plugin.saveSettings();
            this.plugin.reconnectChat();
            this.showInfo(v);
            this.showCaps(v);
          });
        });
      } else {
        s.setDesc('Server offline — Modellname eintippen, dann „Modelle laden“');
        s.addText(t => t.setPlaceholder("qwen3").setValue(this.plugin.settings.chatModel)
          .onChange(async (v: string) => {
            this.plugin.settings.chatModel = v.trim();
            await this.plugin.saveSettings();
            this.plugin.reconnectChat?.();
          }));
        s.addButton(b => b.setButtonText("Modelle laden").onClick(() => this.rerender()));
      }
      this.showInfo(this.plugin.settings.chatModel);
      this.showCaps(this.plugin.settings.chatModel);
    });
  }

  private buildModelDetails(s: Setting): void {
    s.setName("Modelldetails");
    this.infoValue = s.controlEl.createSpan({ cls: "vault-rag-info-value", text: "…" });
  }

  private buildCaps(s: Setting): void {
    s.setName("Fähigkeiten");
    this.capSetting = s;
    this.renderCaps(s, this.lastCaps);
  }

  private buildChatK(s: Setting): void {
    s.setName(`Kontext-Notizen: ${this.plugin.settings.chatK}`)
      .setDesc("Wie viele Notizen als Kontext in den Chat gehen (Auto-RAG)")
      .addSlider(sl => sl.setLimits(1, 20, 1).setValue(this.plugin.settings.chatK)        .onChange(async (v: number) => {
          this.plugin.settings.chatK = v;
          s.setName(`Kontext-Notizen: ${v}`);
          await this.plugin.saveSettings();
        }));
  }

  private buildBudget(s: Setting): void {
    s.setName(`Kontext-Budget: ${this.plugin.settings.contextCharBudget.toLocaleString("de-DE")} Zeichen`)
      .setDesc("Maximale Gesamtlänge des Notiz-Kontexts (anteilig verteilt). Obergrenze richtet sich nach dem Modell-Fenster.")
      .addSlider(sl => {
        sl.setLimits(2000, 32000, 1000).setValue(this.plugin.settings.contextCharBudget)          .onChange(async (v: number) => {
            this.plugin.settings.contextCharBudget = v;
            s.setName(`Kontext-Budget: ${v.toLocaleString("de-DE")} Zeichen`);
            await this.plugin.saveSettings();
          });
        // Sobald das Modell-Fenster bekannt ist (showInfo): Slider-Max daran koppeln + Wert klemmen.
        this.updateBudgetMax = (maxChars: number): void => {
          const max = Math.max(8000, Math.round(maxChars / 1000) * 1000);
          sl.setLimits(2000, max, 1000);
          const val = Math.min(this.plugin.settings.contextCharBudget, max);
          sl.setValue(val);
          s.setName(`Kontext-Budget: ${val.toLocaleString("de-DE")} / max ~${max.toLocaleString("de-DE")} Zeichen`);
          if (val !== this.plugin.settings.contextCharBudget) {
            this.plugin.settings.contextCharBudget = val;   // nur bei echter Klemmung schreiben
            void this.plugin.saveSettings();
          }
        };
      });
  }

  private buildTemp(s: Setting): void {
    s.setName(`Temperatur: ${this.plugin.settings.chatTemperature}`)
      .setDesc("Kreativität vs. Bestimmtheit (0 = deterministisch, höher = kreativer)")
      .addSlider(sl => sl.setLimits(0, 2, 0.1).setValue(this.plugin.settings.chatTemperature)        .onChange(async (v: number) => {
          this.plugin.settings.chatTemperature = v;
          s.setName(`Temperatur: ${v}`);
          await this.plugin.saveSettings();
        }));
  }

  private buildSystemPrompt(s: Setting): void {
    s.setName("System-Prompt")
      .setDesc("Grundanweisung an das Modell. Der Notiz-Kontext wird automatisch angehängt.")
      .addTextArea(t => {
        t.setValue(this.plugin.settings.chatSystemPrompt).onChange(async (v: string) => {
          this.plugin.settings.chatSystemPrompt = v;
          await this.plugin.saveSettings();
        });
        t.inputEl.rows = 8;
        t.inputEl.addClass("vault-rag-prompt-textarea");
      });
  }

  private buildInputPos(s: Setting): void {
    s.setName("Eingabe-Position")
      .setDesc("Wo die Chat-Eingabe sitzt (greift beim nächsten Öffnen des Panels)")
      .addDropdown(d => d.addOption("bottom", "Unten").addOption("top", "Oben").setValue(this.plugin.settings.chatInputPosition)
        .onChange(async (v: string) => {
          this.plugin.settings.chatInputPosition = v as "bottom" | "top";
          await this.plugin.saveSettings();
        }));
  }

  private buildThinking(s: Setting): void {
    s.setName("Thinking unterdrücken")
      .setDesc("Standard für neue Chats. Sendet Suppress-Hints (reasoning_effort/enable_thinking). Pro Chat im Panel umschaltbar. „Testen“ prüft, ob das Modell wirklich abschaltet.")
      .addToggle(t => t.setValue(this.plugin.settings.suppressThinking).onChange(async (v: boolean) => {
        this.plugin.settings.suppressThinking = v;
        await this.plugin.saveSettings();
      }))
      .addButton(b => b.setButtonText("Testen").onClick(async () => {
        const model = this.plugin.settings.chatModel;
        if (isAlwaysOnThinker(model)) { new Notice("Dieses Modell denkt immer (nur low/medium/high)."); return; }
        b.setButtonText("Teste…"); b.setDisabled(true);
        try {
          const res = await this.plugin.chatClient.stream(
            [{ role: "user", content: "Antworte in genau einem Wort: Hallo." }],
            () => {}, () => {}, undefined, { model, suppressThinking: true });
          const happened = reasoningHappened(res.content, res.reasoning);
          new Notice(happened ? "Modell denkt trotz „aus“" : "Thinking wird unterdrückt");
          if (happened) {
            // Live-Nachweis, dass das Modell denkt → Fähigkeiten-Zeile hochstufen.
            this.lastCaps = { ...this.lastCaps, thinking: { support: "always", confidence: "confirmed" } };
            if (this.capSetting) this.renderCaps(this.capSetting, this.lastCaps);
          }
        } catch {
          new Notice("Chat-Endpoint nicht erreichbar");
        } finally { b.setButtonText("Testen"); b.setDisabled(false); }
      }));
  }

  private buildEnter(s: Setting): void {
    s.setName("Enter sendet")
      .setDesc("An: Enter sendet, Shift+Enter macht eine neue Zeile. Aus: umgekehrt.")
      .addToggle(t => t.setValue(this.plugin.settings.enterSends).onChange(async (v: boolean) => {
        this.plugin.settings.enterSends = v;
        await this.plugin.saveSettings();
      }));
  }

  /** Kompakte einzeilige Embedding-Status-Zeile (bei den Embedding-Settings): EIN konsistent
   *  gefärbter Verbindungspunkt + Zähler, live aktualisiert. Kein Control → Wert in controlEl ok. */
  private buildEmbeddingStatus(s: Setting): void {
    s.setName("Embedding-Status");
    const val = s.controlEl.createSpan({ cls: "vault-rag-info-value" });
    const dot = val.createSpan({ cls: "vault-rag-conn-dot" });
    const text = val.createSpan();
    let connected: boolean | null = null;
    const render = (): void => {
      dot.toggleClass("is-ok", connected === true);
      dot.toggleClass("is-error", connected === false);
      const conn = connected === null ? "prüfe…" : connected ? "Verbunden" : "Offline";
      const p = this.plugin.embeddingProgress as { isEmbedding: boolean; embeddedNotes: number; pendingNotes: number } | undefined;
      const counts = p ? `${p.embeddedNotes.toLocaleString("de-DE")} eingebettet · ${p.pendingNotes.toLocaleString("de-DE")} ausstehend` : "";
      const act = p?.isEmbedding ? "Embedding läuft" : "";
      text.setText([conn, act, counts].filter(Boolean).join(" · "));
    };
    render();
    void this.plugin.embedder?.ping().then((ok: boolean) => { connected = ok; render(); });
    this.clearInterval();
    this.refreshInterval = window.setInterval(render, 2000);
  }

  private buildStatusBar(s: Setting): void {
    s.setName("Fortschritt in Statusleiste")
      .setDesc("Zeigt Embedding-Status in der unteren Obsidian-Leiste")
      .addToggle(t => t.setValue(this.plugin.settings.showStatusBar).onChange(async (v: boolean) => {
        this.plugin.settings.showStatusBar = v;
        await this.plugin.saveSettings();
        this.plugin.setStatusBarVisible(v);
      }));
  }
}
