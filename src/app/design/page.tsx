import { notFound } from "next/navigation";
import { DesignGallery } from "./DesignGallery";

/**
 * Design-system gallery (dev only): every UI primitive and every signature
 * utility on the real wallpaper, so a restyle can be checked in all four
 * theme x brand combinations (flip them from the gear menu, or set the
 * `ai-os:theme` / `ai-os:brand` localStorage keys). 404s in production.
 */
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DesignGallery />;
}
