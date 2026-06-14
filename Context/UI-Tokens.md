# Omnecor UI Tokens

This document details the Design System and UI Tokens utilized in the Omnecor V1-Beta client application. Omnecor uses **Tailwind CSS v4.1+** with a CSS-first configuration and **OKLCH color space** variables for fluid, modern, and high-performance user interfaces.

---

## 🎨 Color Palette & Themes

Omnecor supports both Light Mode and Dark Mode, defaulting to **Dark Mode** for a high-tech agentic workstation feel. Colors are defined dynamically using CSS variables mapped in [Globals.css](file:///home/linux/Documents/OmnecorV1-Beta/client/src/Globals.css).

### ☀️ Light Mode Tokens

| CSS Variable | OKLCH Value | UI Role | Description |
| :--- | :--- | :--- | :--- |
| `--background` | `oklch(1 0 0)` | Base Background | Pure white background |
| `--foreground` | `oklch(0.235 0.015 65)` | Base Text | Deep slate/charcoal text |
| `--primary` | `var(--color-blue-700)` | Primary Action | Deep brand blue for primary buttons, active states |
| `--primary-foreground` | `var(--color-blue-50)` | Primary Text | Soft blue-white text on primary backgrounds |
| `--card` / `--popover` | `oklch(1 0 0)` | Containers | White background for card layouts and dropdowns |
| `--secondary` | `oklch(0.98 0.001 286.375)` | Secondary Action | Light silver gray for secondary controls |
| `--muted` / `--accent` | `oklch(0.967 0.001 286.375)` | Subtle Accents | Extremely soft gray for disabled backgrounds or highlights |
| `--muted-foreground` | `oklch(0.552 0.016 285.938)` | Secondary Text | Soft slate gray for captions and metadata |
| `--destructive` | `oklch(0.577 0.245 27.325)` | Danger/Warning | High-contrast crimson red for error states |
| `--border` / `--input` | `oklch(0.92 0.004 286.32)` | Borders | Soft gray borders for inputs and panel separation |
| `--ring` | `oklch(0.623 0.214 259.815)` | Focus Ring | Glowing blue ring for keyboard navigation focus |

### 🌙 Dark Mode Tokens

Active when the `.dark` class is applied to the root element.

| CSS Variable | OKLCH Value | UI Role | Description |
| :--- | :--- | :--- | :--- |
| `--background` | `oklch(0.12 0.01 240)` | Dark Background | Deep navy black base background |
| `--foreground` | `oklch(0.98 0.01 240)` | Dark Text | Bright silver-white main text |
| `--card` / `--popover` | `oklch(0.16 0.01 240)` | Containers | Dark slate container background |
| `--secondary` | `oklch(0.24 0.006 286.033)` | Secondary Action | Dark charcoal gray for secondary buttons |
| `--muted` | `oklch(0.24 0.01 240)` | Muted Background | Deep navy gray for headers or inner panel backgrounds |
| `--accent` | `oklch(0.65 0.15 260)` | Vibrant Accent | Futuristic electric purple/blue accent highlight |
| `--destructive` | `oklch(0.62 0.22 25)` | Danger/Warning | Luminous warning red |
| `--border` / `--input` | `oklch(0.22 0.01 240)` | Borders | Subtle dark navy outlines |
| `--ring` | `oklch(0.65 0.15 260)` | Focus Ring | Electric purple/blue halo for keyboard focus |

### 🛠️ OmMesh Brand Colors (Blueprint Theme)

These high-tech holographic brand colors are available in **Dark Mode** to design state-of-the-art interactive modules and dashboards.

| CSS Variable | OKLCH Value | Color Representation | UI Application |
| :--- | :--- | :--- | :--- |
| `--bg-primary` | `oklch(0.12 0.015 260)` | Deep Midnight Indigo | Master dashboard backdrop |
| `--bg-secondary` | `oklch(0.16 0.018 260)` | Dark Navy Indigo | Navigation sidebar, panels |
| `--bg-elevated` | `oklch(0.20 0.02 260)` | Lighter Indigo Accent | Hover highlights, active panels |
| `--accent-cyan` | `oklch(0.72 0.18 210)` | Luminous Tech Cyan | Neon metrics, active telemetry signals |
| `--accent-purple` | `oklch(0.65 0.21 300)` | Cyber Purple | AI core indicator light |
| `--accent-danger` | `oklch(0.63 0.24 25)` | Bright Crimson | Critical error states or halts |
| `--accent-success` | `oklch(0.75 0.16 160)` | Glowing Green | Verified success, completed operations |

---

## 📐 Spacing & Layout System

Omnecor leverages Tailwind CSS spacing multipliers combined with standard viewport constraints.

### 🔳 Border Radius Tokens

Custom curvature is controlled via a base `--radius` variable set to `0.65rem` (~`10px`), with derived tokens:

- **Extra Small (`--radius-sm`)**: `calc(var(--radius) - 4px)` (approx. `6px`) - used for checkboxes, badges, and tiny buttons.
- **Medium (`--radius-md`)**: `calc(var(--radius) - 2px)` (approx. `8px`) - used for input fields and buttons.
- **Large (`--radius-lg`)**: `var(--radius)` (approx. `10px`) - standard card curvature.
- **Extra Large (`--radius-xl`)**: `calc(var(--radius) + 4px)` (approx. `14px`) - used for modals, dialogs, and outer container cards.

### 📦 Layout Components

- **`.container`**: Standard center container with dynamic horizontal padding matching responsive breakpoints:
  - Mobile: `1rem` padding (`16px`)
  - Tablet (`sm` breakpoint, `>= 640px`): `1.5rem` padding (`24px`)
  - Desktop (`lg` breakpoint, `>= 1024px`): `2rem` padding (`32px`) and max-width capped at `1280px`.
- **`.card-content-safe`**: Layout helper ensuring text items break correctly and never overflow boundary borders (`word-break: break-word`).

---

## 🔤 Typography System

Designed for high readability in technical environments, using system sans-serif font fallbacks.

- **Primary Font Family (`font-sans`)**: Standard sans-serif stack utilizing system UI fonts with specific feature settings (`"rlig" 1, "calt" 1` for legible ligatures).
- **Secondary Code Font Family (`font-mono`)**: UI-monospace, SFMono-Regular, Consolas, or standard monospace.

### Heading Hierarchy

Heading tokens apply automatic sizing and tracking (letter-spacing) configurations:

| Element | Class equivalent | Size / Weight | Visual Role |
| :--- | :--- | :--- | :--- |
| `h1` | `text-4xl` | `2.25rem` / Bold | Screen title, wizard headers |
| `h2` | `text-3xl` | `1.875rem` / SemiBold | Primary sections, dashboard blocks |
| `h3` | `text-2xl` | `1.5rem` / SemiBold | Modals, card titles |
| `h4` | `text-xl` | `1.25rem` / SemiBold | Minor widgets, settings sections |
| `h5` | `text-lg` | `1.125rem` / SemiBold | Sub-panel labels |
| `h6` | `text-base` | `1rem` / SemiBold | Section headers, table labels |
| `p` | `text-base` | `1rem` / Normal | Standard body copy (line-height: relaxed) |
| `small` | `text-sm` | `0.875rem` / Normal | Captions, metadata helper text |

---

## ✨ Micro-Animations & Scrollbars

Omnecor features customized webkit scrollbars for a premium visual experience:

```css
/* Custom scrollbars automatically dim when inactive, and transition smoothly on hover */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.16); /* Dark mode */
  border-radius: 9999px;
  transition: background-color 0.2s ease;
}
```

- **Transitions**: Native transition classes (`transition-all`, `transition-colors`) default to a smooth, organic easing curve.
- **Dark Mode custom variant**: Custom directive `@custom-variant dark (&:is(.dark *));` allows writing highly contextual dark selector rules in standard CSS files.

---

## 📱 5. Mobile APK Token System

To support portrait-locked companion operation, the Android APK uses NativeWind v4 (Tailwind CSS v3 compiler) with static fallbacks mapping to the primary Web design tokens:

### 5.1 Dark Mode HEX Color Fallbacks
Because React Native stylesheet compilers do not support CSS-level `oklch()` values, the following static hexadecimal tokens are defined in [theme.config.js](file:///home/linux/Documents/OmnecorV1-Beta/packaging/android/omnecor-hq/theme.config.js):

| CSS Token | HEX Value | UI Role / Equivalent |
| :--- | :--- | :--- |
| `--background` | `#0e0f14` | Deep obsidian backdrop |
| `--foreground` | `#f8f9fa` | Off-white primary text |
| `--card` | `#151620` | Container cards, sidebar elements |
| `--primary` | `#1d4ed8` | Accent blue for primary triggers |
| `--accent` | `#8b5cf6` | Cyber purple highlights |
| `--accent-cyan` | `#06b6d4` | Signal cyan metrics |
| `--destructive` | `#dc2626` | Alarm red |
| `--border` | `#2a2b36` | Subtle separators |

### 5.2 Device Sizing & Viewport Tokens
*   **Touch Targets:** Minimum vertical/horizontal size of `48dp` (density-independent pixels) for all interactive icons and button components.
*   **Tap Margins:** Minimum layout spacing of `8dp` (`gap-2` or `m-2`) between adjacent selectable inputs.
*   **Viewport Padding:** Mobile standard outer padding is defined as `16dp` (`p-4`) using the `SafeAreaView` context wrapper to adapt layouts below notches and status bars.

