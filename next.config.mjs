// The desktop launcher (desktop/launcher.cjs) builds the UI for the installed
// app out of this folder. It sets:
//   AI_OS_DIST_DIR   build output folder (default ".next"); lets the launcher
//                    build into a staging folder and swap it in only when the
//                    build succeeded, so a failed build never costs the last
//                    good one, and `next dev` / `pnpm build` keep using .next.
//   AI_OS_FAST_BUILD "1" skips lint and the type-check pass (they take most of
//                    a build and `pnpm typecheck` / `pnpm lint` cover them).
const distDir = process.env.AI_OS_DIST_DIR?.trim();
const fast = process.env.AI_OS_FAST_BUILD === "1";

/** @type {import("next").NextConfig} */
const nextConfig = {
  ...(distDir ? { distDir } : {}),
  ...(fast
    ? { typescript: { ignoreBuildErrors: true }, eslint: { ignoreDuringBuilds: true } }
    : {}),
};

export default nextConfig;
