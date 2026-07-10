/**
 * Injects per-code-block action buttons (Run / Preview) into rendered markdown
 * after Streamdown paints. Complements Streamdown's built-in Copy/Download.
 *
 * Runnable languages (python/js/ts/sh) get a ▶ Run button that dispatches
 * `omnecor:run_code`; markup languages (html) get a ⚡ Preview button that
 * dispatches `omnecor:preview_code`. `Chat.tsx` owns the handlers — Run spawns
 * a background job (rendered as a JobBlock in the conversation) and Preview
 * opens the live preview panel. Keeping this a DOM-injection hook mirrors the
 * existing per-block Copy injection, since Streamdown has no per-block slot.
 */
import { useEffect } from "react";

/** Fenced-code languages we can execute as a background job. */
const RUNNABLE = new Set(["python", "py", "javascript", "js", "node", "typescript", "ts", "bash", "sh", "shell"]);
/** Languages the live-preview panel can render. */
const PREVIEWABLE = new Set(["html"]);

/** Detail carried by the `omnecor:run_code` / `omnecor:preview_code` events. */
export interface CodeActionDetail {
  language: string;
  code: string;
}

export function useCodeBlockActions(
  ref: React.RefObject<HTMLElement | null>,
  content: string,
) {
  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    // Streamdown renders each fenced block as
    //   [data-streamdown="code-block"][data-language=…]
    //     └ [data-streamdown="code-block-header"] → language label + Copy/Download toolbar
    //     └ [data-streamdown="code-block-body"] (the <pre><code>)
    // Inject a Run/Preview button inline into that header toolbar so it sits
    // beside Copy/Download (always visible, no overlap with the code). Shiki
    // highlights asynchronously and blocks stream in, so we (re)run injection on
    // every subtree mutation — the `:not([data-cba])` guard makes it idempotent.
    const inject = () => {
      container
        .querySelectorAll<HTMLElement>('[data-streamdown="code-block"]:not([data-cba])')
        .forEach((block) => {
        block.setAttribute("data-cba", "true");
        const lang = (block.getAttribute("data-language") ?? "").toLowerCase();
        const runnable = RUNNABLE.has(lang);
        const previewable = PREVIEWABLE.has(lang);
        if (!runnable && !previewable) return;

        const header = block.querySelector('[data-streamdown="code-block-header"]');
        const toolbar = header?.lastElementChild; // the flex gap-2 button row
        if (!toolbar) return;

        const btn = document.createElement("button");
        btn.textContent = runnable ? "▶ Run" : "⚡ Preview";
        btn.style.cssText = [
          "padding:1px 8px",
          "font-size:11px",
          "font-weight:600",
          "line-height:1.6",
          "background:hsl(var(--primary))",
          "color:hsl(var(--primary-foreground))",
          "border-radius:4px",
          "cursor:pointer",
          "border:none",
        ].join(";");
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          // Shiki renders each line as a display:block <span>, so textContent
          // loses newlines — innerText respects the block layout (and <pre>
          // preserves indentation), giving back faithful multi-line source.
          const codeEl = block.querySelector<HTMLElement>("pre code");
          const code = codeEl?.innerText ?? codeEl?.textContent ?? "";
          window.dispatchEvent(
            new CustomEvent<CodeActionDetail>(
              runnable ? "omnecor:run_code" : "omnecor:preview_code",
              { detail: { language: lang, code } },
            ),
          );
        });
        toolbar.insertBefore(btn, toolbar.firstChild);
      });
    };

    inject();
    const mo = new MutationObserver(() => inject());
    mo.observe(container, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [content, ref]);
}
