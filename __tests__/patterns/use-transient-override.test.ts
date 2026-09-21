/**
 * @jest-environment jsdom
 */

// `useTransientOverride` lives in editable.tsx, which imports the slot server
// actions. Mock that module so the hook can be exercised without dragging
// prisma / next-auth / KMS into the test.
jest.mock("@/app/dashboard/group-actions", () => ({
  assignToBlockSlot: jest.fn(),
  assignMediaToBlockSlot: jest.fn(),
  clearBlockSlot: jest.fn(),
  clearSlotArticle: jest.fn(),
  clearSlotMedia: jest.fn(),
  updateSlotScale: jest.fn(),
  updateSlotImageScale: jest.fn(),
  updateSlotPreviewLength: jest.fn(),
  toggleSlotFeatured: jest.fn(),
  toggleSlotByline: jest.fn(),
  updateImageFloat: jest.fn(),
  updateImageWidth: jest.fn(),
  updateImageCrop: jest.fn(),
  updateMediaCredit: jest.fn(),
  updateMediaAlt: jest.fn(),
}));

import { createElement, useEffect, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTransientOverride, type Transient } from "@/app/patterns/editable";

// react-dom/client needs this flag or every act() call warns.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Mounts the hook and hands back the rendered value plus the committed
 * `set` / `reset`, and a way to re-render with a different server value (what
 * `router.refresh()` does in the editor).
 *
 * The hook result is captured in an effect, not during render, so the probe
 * component stays pure.
 */
function mountHook<T>(initialServerValue: T) {
  const holder: { latest: Transient<T> | null } = { latest: null };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  function Probe({ serverValue }: { serverValue: T }) {
    const transient = useTransientOverride(serverValue);
    useEffect(() => {
      holder.latest = transient;
    });
    return createElement("span", null, String(transient.value));
  }

  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe, { serverValue: initialServerValue }));
  });

  function committed(): Transient<T> {
    if (!holder.latest) throw new Error("probe never committed");
    return holder.latest;
  }

  return {
    /** What the component actually rendered. */
    get rendered() {
      return container.textContent;
    },
    set(v: T) {
      act(() => committed().set(v));
    },
    reset() {
      act(() => committed().reset());
    },
    /** Simulate the refreshed prop arriving from the server. */
    setServerValue(next: T) {
      act(() => {
        root.render(createElement(Probe, { serverValue: next }));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("useTransientOverride", () => {
  it("renders the server value when nothing is pending", () => {
    const hook = mountHook(50);
    expect(hook.rendered).toBe("50");
    hook.unmount();
  });

  it("renders the local override after set()", () => {
    const hook = mountHook(50);
    hook.set(75);
    expect(hook.rendered).toBe("75");
    hook.unmount();
  });

  it("drops the override once the server confirms it", () => {
    const hook = mountHook(50);
    hook.set(75);
    hook.setServerValue(75);
    expect(hook.rendered).toBe("75");

    // And a later server-side change wins outright.
    hook.setServerValue(30);
    expect(hook.rendered).toBe("30");
    hook.unmount();
  });

  it("drops the override when the server value changes to something else", () => {
    const hook = mountHook(50);
    hook.set(75);
    hook.setServerValue(40);
    expect(hook.rendered).toBe("40");
    hook.unmount();
  });

  it("keeps the override while the server value is unchanged", () => {
    // The whole point of the base/value pair: a re-render that doesn't change
    // the server value must not discard a drag in progress.
    const hook = mountHook(50);
    hook.set(75);
    hook.setServerValue(50);
    expect(hook.rendered).toBe("75");
    hook.unmount();
  });

  it("reset() rolls back to the server value — the rejected-mutation path", () => {
    // A refused mutation leaves the server value untouched, so `base` still
    // matches and the override would otherwise render until a reload. `run`
    // calls reset() from its catch; without it this reads "75".
    const hook = mountHook(50);
    hook.set(75);
    expect(hook.rendered).toBe("75");

    hook.reset();
    expect(hook.rendered).toBe("50");
    hook.unmount();
  });

  it("accepts a new override after a reset", () => {
    const hook = mountHook(50);
    hook.set(75);
    hook.reset();
    hook.set(20);
    expect(hook.rendered).toBe("20");
    hook.unmount();
  });

  it("works for string fields too (alt text)", () => {
    const hook = mountHook("");
    hook.set("A dog on the quad");
    expect(hook.rendered).toBe("A dog on the quad");

    hook.reset();
    expect(hook.rendered).toBe("");
    hook.unmount();
  });
});
