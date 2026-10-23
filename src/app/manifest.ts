import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI OS",
    short_name: "AI OS",
    description:
      "A virtual desktop where a human and an AI agent can both drive the same apps.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f3",
    theme_color: "#f5f5f3",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
