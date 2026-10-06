// Shared GetInRoute design tokens — a premium corporate mobility palette.
// Royal blue primary, deep navy ink, light-blue accent, near-white surfaces.
export const colors = {
  bg: "#F4F7FC",
  panel: "#FFFFFF",
  panel2: "#EEF3FB",
  line: "#DCE4F0",
  text: "#0F1E3D",
  textDim: "#5A6B8C",
  primary: "#2F5BFF",
  primaryDark: "#1E3A8A",
  primarySoft: "#E8EFFF",
  navy: "#0B1B3A",
  accent: "#60A5FA",
  teal: "#2F5BFF", // kept for backward compatibility (was the brand accent)
  amber: "#F59E0B",
  coral: "#EF4444",
  green: "#16A34A",
  violet: "#7C3AED"
};

export const spacing = { xs: 6, sm: 10, md: 16, lg: 20, xl: 28 };

export const radius = { sm: 10, md: 14, lg: 20, pill: 999 };

export const shadow = {
  card: {
    shadowColor: "#0F1E3D",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  }
};

export const font = {
  display: { fontWeight: "800", letterSpacing: -0.4 },
  label: { fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: colors.textDim },
  mono: { fontVariant: ["tabular-nums"] }
};
