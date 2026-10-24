// dsh-browser · 富文本与代码编辑器原语 (Monaco, CodeMirror & Rich Editors)
import type { Page } from "playwright-core";

export async function fillEditorHelper(
  page: Page,
  selector: string,
  content: string,
): Promise<boolean> {
  const handled = await page.evaluate(
    ({ sel, text }) => {
      const el = document.querySelector(sel);
      if (!el) return false;

      // 1. Monaco Editor (查找挂载在 window.monaco 上的模型实例)
      const win = window as any;
      if (win.monaco && win.monaco.editor) {
        const editors = win.monaco.editor.getEditors?.() || [];
        for (const ed of editors) {
          const domNode = ed.getDomNode?.();
          if (domNode && (domNode === el || domNode.contains(el) || el.contains(domNode))) {
            ed.setValue(text);
            return true;
          }
        }
        if (editors.length === 1) {
          editors[0].setValue(text);
          return true;
        }
      }

      // 2. CodeMirror (v5 或 v6)
      const cmInstance = (el as any).CodeMirror || (el.querySelector(".CodeMirror") as any)?.CodeMirror;
      if (cmInstance && typeof cmInstance.setValue === "function") {
        cmInstance.setValue(text);
        return true;
      }

      // 3. ProseMirror / Quill / 原生 contenteditable
      const editable =
        el.getAttribute("contenteditable") === "true"
          ? (el as HTMLElement)
          : (el.querySelector("[contenteditable='true']") as HTMLElement | null);

      if (editable) {
        editable.focus();
        document.execCommand("selectAll", false);
        document.execCommand("insertText", false, text);
        editable.dispatchEvent(new Event("input", { bubbles: true }));
        editable.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }

      return false;
    },
    { sel: selector, text: content },
  );

  return handled;
}
