// Which allowed models are already on disk, read from Ollama's manifest folder,
// so Setup can answer "is the model installed?" without starting Ollama.
// Pure: the file check is injected, and nothing here imports extensionless.
import path from "node:path";

/** "gemma4:12b" -> manifests/registry.ollama.ai/library/gemma4/12b; "user/m:t" -> .../user/m/t */
export function manifestPath(modelsDir: string, model: string): string | null {
  const [name, tag = "latest", ...extra] = model.trim().split(":");
  if (extra.length > 0 || !name || !tag || /[\\]|\.\./.test(model)) return null;
  const parts = name.split("/");
  if (parts.length > 2 || parts.some((p) => !p)) return null;
  const namespace = parts.length === 2 ? parts[0] : "library";
  const base = parts.length === 2 ? parts[1] : parts[0];
  return path.join(modelsDir, "manifests", "registry.ollama.ai", namespace, base, tag);
}

/** The candidates that have a manifest on disk (in the order given). */
export function modelsOnDisk(
  modelsDir: string,
  candidates: readonly string[],
  exists: (file: string) => boolean,
): string[] {
  return candidates.filter((model) => {
    const file = manifestPath(modelsDir, model);
    return file !== null && exists(file);
  });
}
