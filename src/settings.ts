import { App, PluginSettingTab, Setting } from "obsidian";

export interface VaultRagSettings { k: number; minSim: number; indexDir: string; exclude: string[]; }
export const DEFAULT_SETTINGS: VaultRagSettings = {
  k: 20, minSim: 0.3, indexDir: "_vaultrag", exclude: ["Templates/", "Archive/", ".trash/"],
};

export class VaultRagSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: any) { super(app, plugin); }
  display(): void {
    const { containerEl } = this; containerEl.empty();
    new Setting(containerEl).setName("Anzahl Treffer (k)").addSlider(s =>
      s.setLimits(5, 50, 1).setValue(this.plugin.settings.k).onChange(async (v: number) => { this.plugin.settings.k = v; await this.plugin.saveSettings(); this.plugin.refresh(); }));
    new Setting(containerEl).setName("Min. Ähnlichkeit").addSlider(s =>
      s.setLimits(0, 0.9, 0.05).setValue(this.plugin.settings.minSim).onChange(async (v: number) => { this.plugin.settings.minSim = v; await this.plugin.saveSettings(); this.plugin.refresh(); }));
    new Setting(containerEl).setName("Index-Ordner").addText(t =>
      t.setValue(this.plugin.settings.indexDir).onChange(async (v: string) => { this.plugin.settings.indexDir = v; await this.plugin.saveSettings(); }));
  }
}
