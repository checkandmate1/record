/**
 * @jest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HamburgerButton } from "@/app/sidebar-menu";

// No `@testing-library/react` in devDependencies — drive React 19 directly.
let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => {
    root.render(node);
  });
}

function trigger(): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Open menu"]',
  );
  if (!el) throw new Error("hamburger trigger is missing");
  return el;
}

function panel(): HTMLElement {
  const el = document.querySelector<HTMLElement>("nav");
  if (!el) throw new Error("menu panel is missing");
  return el;
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  render(createElement(HamburgerButton, {}));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("HamburgerButton", () => {
  it("marks the closed menu inert and the trigger collapsed", () => {
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().getAttribute("aria-controls")).toBe(panel().id);
    expect(panel().hasAttribute("inert")).toBe(true);
  });

  it("opens the menu, un-inerts it and moves focus inside", () => {
    act(() => trigger().click());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(panel().hasAttribute("inert")).toBe(false);
    expect((document.activeElement as HTMLElement).getAttribute("aria-label")).toBe(
      "Close menu",
    );
  });

  it("closes on Escape and returns focus to the trigger", () => {
    act(() => trigger().click());
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(panel().hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });

  it("closes from the close button and returns focus to the trigger", () => {
    act(() => trigger().click());
    const close = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Close menu"]',
    )!;
    act(() => close.click());
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
  });
});
