# Omnecor — UI & Design System Rules

This document outlines the visual behavior, layout constraints, component styling, and structural patterns governing the Omnecor V1-Beta client interface. All new screens, panels, and widgets must adhere strictly to these rules to maintain a cohesive workstation aesthetic.

---

## 🎨 1. Theme & Color Aesthetics

Omnecor defaults to a high-tech, dark **Blueprint Workspace** theme. Dynamic variables are mapped using HSL/OKLCH color spaces in [Globals.css](file:///home/linux/Documents/OmnecorV1-Beta/client/src/Globals.css).

*   **Base Backdrop:** Deep navy-black (`oklch(0.12 0.01 240)`).
*   **Containers & Cards:** Dark slate panels (`oklch(0.16 0.01 240)`).
*   **Accent Color:** Vibrant tech cyan/electric blue (`oklch(0.65 0.15 260)`) used for focus rings and system telemetry signals.
*   **Signaling Colors:**
    *   *AI Core / Reasoning:* Holographic purple (`oklch(0.65 0.21 300)`).
    *   *Completed / Validated:* Neon green (`oklch(0.75 0.16 160)`).
    *   *Errors / Halts:* Luminous warning red (`oklch(0.63 0.24 25)`).

### 🚨 Hover & Selection Rule:
Every interactive button, list item, or custom card must feature a hover transition (`duration-200` or `transition-colors`) utilizing the `--color-bg-elevated` token for feedback. Active states must apply the accent borders or active glow indicators.

---

## 📐 2. Spacing, Borders & Radius System

Curvature is controlled via a centralized base `--radius` variable set to `0.65rem` (~`10px`). Always resolve child corners derived from the base radius:

*   **Inputs & Buttons:** Use `--radius-md` (`calc(var(--radius) - 2px)` / ~`8px`) to ensure tight borders.
*   **Cards & Widgets:** Use `--radius-lg` (`var(--radius)` / ~`10px`) for standard cards.
*   **Dialogs & Outer Modals:** Use `--radius-xl` (`calc(var(--radius) + 4px)` / ~`14px`) to create clear depth.

---

## 🔤 3. Typography & Text Boundaries

### 3.1 Font Styling
*   **General UI Font:** Standard sans-serif stack utilizing system UI fonts with specific feature settings (`"rlig" 1, "calt" 1` for legible ligatures).
*   **Technical Code Font:** Monospace stack (`font-mono text-sm bg-muted px-1.5 py-0.5 rounded`).

### 3.2 Heading Hierarchy
Every page must define a strict heading hierarchy to comply with structural standards:
*   `h1`: Screen titles, page headers (`text-4xl font-bold tracking-tight`).
*   `h2` / `h3`: Sub-section layouts, modal labels, metric descriptors (`font-semibold tracking-tight`).
*   `p`: Standard copy (`text-base leading-relaxed`).

### ⚠️ Text-Overflow Prevention (The Safe Containment Rule):
To prevent long AI outputs, file paths, or token log segments from breaking borders, all custom layouts must wrap text inside safe text wrappers:
*   Apply the `.card-content-safe` class to text wrappers.
*   Enforce `overflow-wrap: break-word` and `word-break: break-word` on text containers.
*   Set a parent boundary of `max-width: 100%` on cards or container divs.

---

## ✨ 4. Micro-Animations & Scrollbars

Omnecor features customized webkit scrollbars designed to dim when inactive and transition smoothly on hover:

```css
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.16); /* Dark Mode standard */
  border-radius: 9999px;
  transition: background-color 0.2s ease;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.32);
}
```

*   **Transitions:** Interactive states must utilize transitions to prevent jarring jumps. Default to `transition-all duration-200 ease-in-out` on buttons and tab items.
*   **Interactive cursors:** Apply `cursor-pointer` to buttons, checkboxes, radio inputs, and select dropdown triggers.

---

## 📊 5. Layout & Semantic Structure

### 5.1 Three-Pane Design Architecture
The primary Omnecor workspace utilizes a responsive three-pane layout:
1.  **Sidebar (Resource Navigation):** Houses OMMESH connections and model settings.
2.  **Center Canvas (Active Workspace):** Contains active chat streams, 3D assets viewports, or node editors.
3.  **Inspector (Telemetry & Logging):** Houses spend logs, real-time telemetry gauges, and audit lists.

### 5.2 SEO & Interactive Elements Directives
*   **Semantic Elements:** Use `<header>`, `<main>`, `<section>`, and `<aside>` layouts. Do not construct entire layouts using nested `<div>` wrappers.
*   **Unique Component IDs:** Every interactive button, toggle, or text input must be assigned a unique, descriptive HTML ID (e.g. `id="btn-trigger-model-download"`) for end-to-end testing verification.

---

## 📱 6. Mobile (APK) UI Rules

To guarantee visual comfort and responsive execution on portable devices, the Android APK companion must implement the following layout rules:

### 6.1 Layout Constraints & Safe Areas
*   **Portrait-Locked Layouts:** Screens are locked in vertical (portrait) orientation. All grid panels must reflow into vertical columns (`flex-col`). Do not implement horizontal multi-pane panels unless collapsible.
*   **Safe Area Coverage:** Wrap all root screens with `SafeAreaView` from `react-native-safe-area-context` to automatically offset page content below phone notches, cameras, and system navigation drawers.

### 6.2 Touch Boundaries & Sizing
*   **Tap Target Safety:** Buttons, icons, switches, and list actions must occupy a minimum interactive footprint of `48dp` x `48dp` to prevent adjacent mis-taps.
*   **Interactive Row Spacing:** List items in selections or calendars must apply a minimum spacing gap of `8dp` (`gap-2` / `m-2`).

### 6.3 Haptic Feedback & Vibrations
To compensate for the absence of mouse hover effects, mobile views must trigger active device vibrations:
*   *Success Confirmation (e.g. task done, model pulled):* Short single buzz (`Haptics.notificationAsync(Success)`).
*   *Halt / Warning Checkpoint:* Double pulse (`Haptics.notificationAsync(Warning)`).
*   *Error / Process Crash:* Long heavy vibration (`Haptics.notificationAsync(Error)`).

### 6.4 Touch Gesture Mappings (WebGL 3D Viewer)
Touch actions inside WebView containers must map to standard CAD movements:
*   *Orbit Camera:* Single-finger touch and drag across the canvas.
*   *Zoom View:* Two-finger pinch-in (zoom out) or pinch-out (zoom in).
*   *Pan View:* Two-finger horizontal or vertical swipe.

