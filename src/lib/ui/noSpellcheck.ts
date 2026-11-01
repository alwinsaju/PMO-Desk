/**
 * Spread on search, email, ID and other non-prose inputs so the browser does
 * not underline them or "fix" them: `<Input {...noSpellcheck} />`. Put it
 * before your own props to override one (e.g. `autoComplete="email"`).
 */
export const noSpellcheck = {
  spellCheck: false,
  autoComplete: "off",
  autoCapitalize: "off",
  autoCorrect: "off",
} as const;
