import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PMO Desk",
    short_name: "PMO Desk",
    description:
      "A virtual desktop where a human and an AI agent can both drive the same apps.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f3",
    theme_color: "#f5f5f3",
    icons: [
      { src: "/brand/mark-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/mark-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/mark.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
