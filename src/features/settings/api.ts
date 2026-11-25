import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppConfig, ViewMode } from "./types";

export interface ShortcutCheckResult {
  available: boolean;
  conflictType: "none" | "current" | "invalid" | "system" | "registered" | "unknown";
  message: string;
}

export function getConfig(): Promise<AppConfig> {
  return invoke("config_get");
}

export function saveConfig(config: AppConfig): Promise<AppConfig> {
  return invoke("config_save", { config });
}

export function checkGlobalShortcut(shortcut: string): Promise<ShortcutCheckResult> {
  return invoke("global_shortcut_check", { shortcut });
}

export async function chooseDataDirectory(): Promise<string | null> {
  const path = await open({
    directory: true,
    multiple: false,
  });

  return typeof path === "string" ? path : null;
}

export function migrateDataDir(newDataDir: string): Promise<AppConfig> {
  return invoke("config_migrate_data_dir", { newDataDir });
}

export async function chooseBackgroundImage(): Promise<string | null> {
  const path = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  });

  return typeof path === "string" ? path : null;
}

export function normalizeViewMode(value: string): ViewMode {
  if (value === "edit" || value === "split" || value === "preview" || value === "live") {
    return value;
  }

  return "split";
}

// AppConfig 的字段都是原始值，逐字段比较即精确比较。
// 用于跳过本窗口自己 emit 的 config-changed 回声，避免内容未变却重渲染
export function isSameConfig(current: AppConfig | null, next: AppConfig): boolean {
  if (!current) return false;
  const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
  for (const key of keys) {
    if (!Object.is(current[key as keyof AppConfig], next[key as keyof AppConfig])) return false;
  }
  return true;
}
