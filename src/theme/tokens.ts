/** Canonical Hypercolor + Pubky layout tokens used by contrast tests and UI. */

export const PURPLE = {
  brand: "#7c3aed",
  brandDeep: "#4c1d95",
  brandMuted: "#c4b5fd",
  brandSoft: "#a78bfa",
  brandText: "#9a67f2",
  brandHighlight: "#e9d5ff",
  surfaceBrand: "#1f1b2e",
  onBrandMuted: "#efe6fd",
} as const;

export const TEAL = {
  "300": "#5eead4",
  "400": "#2dd4bf",
  "500": "#14b8a6",
} as const;

export const SURFACES = {
  background: "#05050A",
  card: "#111111",
  secondary: "#303034",
  foreground: "#f9fafb",
  mutedForeground: "#9ca3af",
  secondaryForeground: "#d4d4db",
  textOnBrand: "#ffffff",
  onTeal: "#05050A",
} as const;

export type ContrastPairing = {
  name: string;
  foreground: string;
  background: string;
  /** WCAG AA: 4.5 body text, 3 large/UI */
  minRatio: 4.5 | 3;
};

export const CONTRAST_PAIRINGS: readonly ContrastPairing[] = [
  {
    name: "foreground on background",
    foreground: SURFACES.foreground,
    background: SURFACES.background,
    minRatio: 4.5,
  },
  {
    name: "muted-foreground on background",
    foreground: SURFACES.mutedForeground,
    background: SURFACES.background,
    minRatio: 4.5,
  },
  {
    name: "brand muted text on background",
    foreground: PURPLE.brandMuted,
    background: SURFACES.background,
    minRatio: 4.5,
  },
  {
    name: "brandText on background (large/UI)",
    foreground: PURPLE.brandText,
    background: SURFACES.background,
    minRatio: 3,
  },
  {
    name: "textOnBrand on brand (CTA)",
    foreground: SURFACES.textOnBrand,
    background: PURPLE.brand,
    minRatio: 3,
  },
  {
    name: "dark on teal-300",
    foreground: SURFACES.onTeal,
    background: TEAL["300"],
    minRatio: 4.5,
  },
  {
    name: "dark on teal-400",
    foreground: SURFACES.onTeal,
    background: TEAL["400"],
    minRatio: 4.5,
  },
  {
    name: "dark on teal-500",
    foreground: SURFACES.onTeal,
    background: TEAL["500"],
    minRatio: 4.5,
  },
  {
    name: "card-foreground on card",
    foreground: SURFACES.foreground,
    background: SURFACES.card,
    minRatio: 4.5,
  },
  {
    name: "secondary-foreground on secondary",
    foreground: SURFACES.secondaryForeground,
    background: SURFACES.secondary,
    minRatio: 4.5,
  },
];
