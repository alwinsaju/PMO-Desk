import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * The folder of an embeddable (bundled) Python, recognised by the python3xx.zip
 * stdlib beside the executable; undefined for a venv or a regular install.
 * The bundled runtime ships without python3xx._pth, so without PYTHONHOME the
 * interpreter reads the registry and adds the Lib and DLLs of any python.org
 * Python on the machine, whose extension modules then crash it (0xC0000005).
 */
export function embeddedPythonHome(pythonExe?: string): string | undefined {
  if (!pythonExe) return undefined;
  const dir = path.dirname(pythonExe);
  try {
    return readdirSync(dir).some((name) => /^python\d+\.zip$/i.test(name))
      ? dir
      : undefined;
  } catch {
    return undefined;
  }
}
