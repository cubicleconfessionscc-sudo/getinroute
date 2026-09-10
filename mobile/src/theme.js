// Shared design tokens across every screen, kept consistent with the
// admin dashboard's "control room" identity (admin-dashboard/index.html)
// but lightened for a mobile, one-handed context.
export const colors = {
  bg: "#F4F6FA",
  panel: "#FFFFFF",
  panel2: "#EAEEF4",
  line: "#D8DFE8",
  text: "#17202C",
  textDim: "#5B6675",
  amber: "#C77E00",
  teal: "#00D9C0",
  coral: "#E23B3B",
  violet: "#8B7CF6"
};

export const spacing = { xs: 6, sm: 10, md: 16, lg: 24, xl: 32 };

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export const font = {
  display: { fontWeight: "700", letterSpacing: -0.3 },
  label: { fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: colors.textDim },
  mono: { fontVariant: ["tabular-nums"] }
};
