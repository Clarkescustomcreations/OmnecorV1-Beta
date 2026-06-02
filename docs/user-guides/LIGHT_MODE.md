# Light Mode & Appearance Settings

Omnecor ships with a full light/dark theme system. Your preference is stored locally and applied instantly without a page reload.

---

## Switching Themes

### Via the UI

1. Open **Settings** from the left navigation sidebar.
2. Click the **Appearance** tab.
3. Click either the **Dark** or **Light** tile. The interface updates immediately.

### Via Keyboard Shortcut

There is no default keyboard shortcut for theme toggling, but you can bind one through the Command Palette once that feature is wired:

```
Ctrl+K → type "theme" → select Toggle Theme
```

---

## Available Themes

| Theme | Description | Best for |
|---|---|---|
| **Dark** | Deep background with light text and muted accents. | Low-light environments, extended coding sessions, OLED displays. |
| **Light** | White/off-white background with dark text. | Bright offices, daylight use, accessibility needs. |

Both themes meet **WCAG 2.1 AA** contrast requirements verified with axe-core.

---

## How It Works

The theme system is implemented in [`client/src/contexts/ThemeContext.tsx`](../../client/src/contexts/ThemeContext.tsx).

**Storage:** Your selection is persisted in `localStorage` under the key `"theme"`. This means it survives page reloads and browser restarts without hitting the server.

**Application:** The `ThemeProvider` component toggles the `dark` CSS class on `document.documentElement`. TailwindCSS's `darkMode: "class"` strategy picks this up and swaps all `dark:` variant rules across the entire component tree.

```tsx
// ThemeContext.tsx — simplified
useEffect(() => {
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  localStorage.setItem("theme", theme);
}, [theme]);
```

**Default theme:** `"light"` (set in `ThemeProvider`'s `defaultTheme` prop in `main.tsx`). If no preference is stored in `localStorage`, light mode is used.

---

## CSS Custom Properties

Both themes are driven by CSS custom properties defined in [`client/src/index.css`](../../client/src/index.css). All shadcn/ui components consume these variables, so custom components built with Tailwind utility classes (`bg-background`, `text-foreground`, `border-border`, etc.) inherit the theme automatically.

Key variables (light → dark):

| Variable | Light value | Dark value |
|---|---|---|
| `--background` | `0 0% 100%` (white) | `224 71% 4%` (near-black) |
| `--foreground` | `224 71% 4%` (near-black) | `213 31% 91%` (off-white) |
| `--muted` | `220 14% 96%` | `223 47% 11%` |
| `--primary` | brand color | brand color |
| `--card` | `0 0% 100%` | `224 71% 4%` |
| `--border` | `220 13% 91%` | `216 34% 17%` |

---

## Programmatic Access

Use the `useTheme` hook anywhere in the React component tree:

```tsx
import { useTheme } from "@/contexts/ThemeContext";

function MyComponent() {
  const { theme, setTheme, toggleTheme } = useTheme();

  return (
    <button onClick={toggleTheme}>
      Current theme: {theme}
    </button>
  );
}
```

**Hook API:**

| Property | Type | Description |
|---|---|---|
| `theme` | `"light" \| "dark"` | Current active theme |
| `setTheme(t)` | `(theme: Theme) => void` | Set a specific theme |
| `toggleTheme()` | `() => void \| undefined` | Toggle between light and dark |
| `switchable` | `boolean` | Whether the theme can be changed (always `true` in production) |

---

## Extending the Theme System

To add a new theme (e.g., high-contrast or solarized):

1. Add a new variant to the `Theme` type in `ThemeContext.tsx`:
   ```tsx
   export type Theme = "light" | "dark" | "high-contrast";
   ```
2. Add the CSS variable block in `index.css` under a `.high-contrast` root selector.
3. Update `ThemeProvider` to add/remove the class name.
4. Add the new option to `THEME_OPTIONS` in `Settings.tsx` → `AppearancePanel`.

---

## Related

- [Settings.tsx — AppearancePanel](../../client/src/pages/Settings.tsx) — UI implementation
- [ThemeContext.tsx](../../client/src/contexts/ThemeContext.tsx) — Context provider source
- [Setup Wizard — Step 7](../setup/SETUP_WIZARD.md#step-7--appearance) — First-launch theme selection
