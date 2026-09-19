/**
 * @jest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dialog } from "@/app/components/dialog";

// `@testing-library/react` is not a dependency of this project, so these tests
// drive React 19's own `act` + `react-dom/client` directly.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => {
    root.render(node);
  });
}

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    );
  });
}

function dialogPanel(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!el) throw new Error("dialog is not rendered");
  return el;
}

function body(onClose: () => void) {
  return createElement(
    "div",
    null,
    createElement("h2", { id: "dlg-title" }, "Past Round Tables"),
    createElement("button", { type: "button", "data-testid": "first" }, "First"),
    createElement("a", { href: "/somewhere" }, "Middle"),
    createElement(
      "button",
      { type: "button", "data-testid": "last", onClick: onClose },
      "Last",
    ),
  );
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("Dialog", () => {
  it("renders nothing while closed", () => {
    render(
      createElement(
        Dialog,
        { open: false, onClose: jest.fn(), labelledBy: "dlg-title" },
        body(jest.fn()),
      ),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("exposes dialog semantics and an accessible name", () => {
    render(
      createElement(
        Dialog,
        { open: true, onClose: jest.fn(), labelledBy: "dlg-title" },
        body(jest.fn()),
      ),
    );
    const panel = dialogPanel();
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(panel.getAttribute("aria-labelledby")).toBe("dlg-title");
    expect(panel.getAttribute("tabindex")).toBe("-1");
  });

  it("falls back to aria-label when there is no labelled heading", () => {
    render(
      createElement(
        Dialog,
        { open: true, onClose: jest.fn(), label: "Settings" },
        createElement("button", { type: "button" }, "x"),
      ),
    );
    expect(dialogPanel().getAttribute("aria-label")).toBe("Settings");
  });

  it("moves focus to the first focusable element on open", () => {
    render(
      createElement(
        Dialog,
        { open: true, onClose: jest.fn(), labelledBy: "dlg-title" },
        body(jest.fn()),
      ),
    );
    expect(
      (document.activeElement as HTMLElement).dataset.testid,
    ).toBe("first");
  });

  it("closes on Escape", () => {
    const onClose = jest.fn();
    render(
      createElement(
        Dialog,
        { open: true, onClose, labelledBy: "dlg-title" },
        body(jest.fn()),
      ),
    );
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not react to Escape while closed", () => {
    const onClose = jest.fn();
    render(
      createElement(
        Dialog,
        { open: false, onClose, labelledBy: "dlg-title" },
        body(jest.fn()),
      ),
    );
    press("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps Tab at the end of the dialog", () => {
    render(
      createElement(
        Dialog,
        { open: true, onClose: jest.fn(), labelledBy: "dlg-title" },
        body(jest.fn()),
      ),
    );
    const last = document.querySelector<HTMLElement>('[data-testid="last"]')!;
    act(() => last.focus());
    press("Tab");
    expect(
      (document.activeElement as HTMLElement).dataset.testid,
    ).toBe("first");
  });

  it("traps Shift+Tab at the start of the dialog", () => {
    render(
      createElement(
        Dialog,
        { open: true, onClose: jest.fn(), labelledBy: "dlg-title" },
        body(jest.fn()),
      ),
    );
    press("Tab", { shiftKey: true });
    expect(
      (document.activeElement as HTMLElement).dataset.testid,
    ).toBe("last");
  });

  it("pulls focus back inside when it has escaped the dialog", () => {
    render(
      createElement(
        Dialog,
        { open: true, onClose: jest.fn(), labelledBy: "dlg-title" },
        body(jest.fn()),
      ),
    );
    act(() => (document.activeElement as HTMLElement).blur());
    press("Tab");
    expect(
      (document.activeElement as HTMLElement).dataset.testid,
    ).toBe("first");
  });

  it("closes on a backdrop click", () => {
    const onClose = jest.fn();
    render(
      createElement(
        Dialog,
        {
          open: true,
          onClose,
          labelledBy: "dlg-title",
          backdropClassName: "backdrop",
        },
        body(jest.fn()),
      ),
    );
    const backdrop = document.querySelector<HTMLElement>(".backdrop")!;
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    act(() => {
      backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the element that was focused before opening", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();

    const node = (open: boolean) =>
      createElement(
        Dialog,
        { open, onClose: jest.fn(), labelledBy: "dlg-title" },
        body(jest.fn()),
      );

    render(node(true));
    expect((document.activeElement as HTMLElement).dataset.testid).toBe("first");

    render(node(false));
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("locks and restores body scrolling", () => {
    const node = (open: boolean) =>
      createElement(
        Dialog,
        { open, onClose: jest.fn(), labelledBy: "dlg-title" },
        body(jest.fn()),
      );
    render(node(true));
    expect(document.body.style.overflow).toBe("hidden");
    render(node(false));
    expect(document.body.style.overflow).toBe("");
  });
});
