import { ImageResponse } from "next/og";

export const size = {
  width: 512,
  height: 512,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#f5f5f3",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: "#0f766e",
          borderRadius: 112,
          color: "#ffffff",
          display: "flex",
          fontFamily: "Arial, sans-serif",
          fontSize: 168,
          fontWeight: 700,
          height: 384,
          justifyContent: "center",
          letterSpacing: -16,
          paddingRight: 16,
          width: 384,
        }}
      >
        AI
      </div>
    </div>,
    size,
  );
}
