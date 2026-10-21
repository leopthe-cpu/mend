import { describe, expect, it } from "vitest";

import { UnsavedRegistry } from "./unsaved";

describe("UnsavedRegistry", () => {
  it("is dirty only while a form has unsaved edits", () => {
    const r = new UnsavedRegistry();
    expect(r.anyDirty()).toBe(false);
    r.set("a", { dirty: false, save: async () => true });
    expect(r.anyDirty()).toBe(false);
    r.set("b", { dirty: true, save: async () => true });
    expect(r.anyDirty()).toBe(true);
    r.delete("b");
    expect(r.anyDirty()).toBe(false);
  });

  it("saves dirty forms only and stops at the first failure", async () => {
    const r = new UnsavedRegistry();
    const calls: string[] = [];
    r.set("clean", { dirty: false, save: async () => (calls.push("clean"), true) });
    r.set("one", { dirty: true, save: async () => (calls.push("one"), false) });
    r.set("two", { dirty: true, save: async () => (calls.push("two"), true) });
    expect(await r.saveAll()).toBe(false);
    expect(calls).toEqual(["one"]);
  });
});
