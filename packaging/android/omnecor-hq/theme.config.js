/** @type {const} */
const themeColors = {
  // Light mode values
  // Dark mode values match UI-Tokens.md §5.1 OKLCH→HEX fallbacks exactly
  background:  { light: '#ffffff',  dark: '#0e0f14' },
  foreground:  { light: '#11181C',  dark: '#f8f9fa' },
  card:        { light: '#f5f5f5',  dark: '#151620' },
  primary:     { light: '#1d4ed8',  dark: '#1d4ed8' },
  accent:      { light: '#7c3aed',  dark: '#8b5cf6' },
  accentCyan:  { light: '#0891b2',  dark: '#06b6d4' },
  destructive: { light: '#dc2626',  dark: '#dc2626' },
  border:      { light: '#E5E7EB',  dark: '#2a2b36' },
  muted:       { light: '#687076',  dark: '#9BA1A6' },
  success:     { light: '#22C55E',  dark: '#4ADE80' },
  warning:     { light: '#F59E0B',  dark: '#FBBF24' },
};

module.exports = { themeColors };
