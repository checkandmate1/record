/**
 * @jest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// `@/app/sign-out-action` pulls in `@/lib/auth` (ESM `next-auth`), which Jest
// cannot transform — see `__tests__/CLAUDE.md`.
jest.mock("@/app/sign-out-action", () => ({ signOutAction: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AccountDropdown } = require("@/app/account-dropdown");

let container: HTMLDivElement;
let root: Root;

const props = {
  userName: "Ada Lovelace",
  userEmail: "ada@horacemann.org",
  userImage: null,
  userRole: "WEB_MASTER",
};

function trigger(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>("button");
  if (!el) throw new Error("dropdown trigger is missing");
  return el;
}

function menu(): HTMLElement {
  const id = trigger().getAttribute("aria-controls")!;
  const el = document.getElementById(id);
  if (!el) throw new Error("dropdown menu is missing");
  return el;
}

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(AccountDropdown, props)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AccountDropdown", () => {
  it("marks the closed menu inert and the trigger collapsed", () => {
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(menu().hasAttribute("inert")).toBe(true);
  });

  it("keeps closed-menu links out of the tab order", () => {
    // `inert` is what removes them; assert the attribute is on the ancestor of
    // every link rather than relying on jsdom implementing inert itself.
    const links = menu().querySelectorAll("a, button");
    expect(links.length).toBeGreaterThan(0);
    links.forEach((el) => expect(el.closest("[inert]")).toBe(menu()));
  });

  it("opens on click", () => {
    act(() => trigger().click());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(menu().hasAttribute("inert")).toBe(false);
  });

  it("closes on Escape and returns focus to the trigger", () => {
    act(() => trigger().click());
    act(() => {
      trigger().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(menu().hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });
});
