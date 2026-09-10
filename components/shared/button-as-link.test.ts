import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * A link that looks like a button must be `<ButtonLink>`, never
 * `<Button render={<Link />}>`.
 *
 * Base UI's `Button` has exactly two modes and neither one is a link
 * (`@base-ui/react/internals/use-button/useButton.js:183-187`):
 *
 * ```js
 * isNativeButton ? { type: 'button' } : { role: 'button' }
 * ```
 *
 * The default (`true`) puts `type="button"` on the `<a>`, where `type` means
 * something else entirely, and makes `isLink` compute false so **Space
 * activates the anchor** like a button — links take Enter; Space scrolls.
 * Setting `nativeButton={false}` silences the console error and fixes the
 * keys, but does it by putting `role="button"` on the anchor, so assistive
 * tech stops announcing a link at all. Trading the first for the second is
 * not a fix, and it is what this test exists to stop someone doing.
 *
 * Twenty-four call sites had the default. It was found in a browser — the
 * Next dev overlay on `/sales` — not by any test, which is why there is now a
 * test.
 *
 * This walks the source rather than rendering, because the defect is a choice
 * of component at a call site: there is nothing to unit-test, and the 25th
 * call site is the one that would get it wrong.
 *
 * `<DropdownMenuItem render={<Link />}>` is fine and is not matched here —
 * Base UI's `MenuItem` defaults `nativeButton` to `false` already
 * (`menu/item/MenuItem.js:28`), and `role="menuitem"` is what a menu entry
 * should be announced as.
 */

const ROOTS = ["features", "components", "app"];

/** This file and the component it guards both quote the bad pattern in prose. */
const EXEMPT = ["button-link", "button-as-link"];

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") yield* walk(path);
    } else if (entry.name.endsWith(".tsx")) {
      yield path;
    }
  }
}

/**
 * Every `<Button …>` opening tag in a file, as its full source text.
 *
 * Walks to the tag's own `>` counting braces rather than matching a regex
 * across the file: a `<Button>` here routinely spans five or six lines, and a
 * lazy match would run from one button's `<Button` to a later one's `>` and
 * read two elements' props as if they were one.
 */
function buttonTags(source: string): string[] {
  const tags: string[] = [];
  const open = /<Button(?=[\s/>])/g;
  let match = open.exec(source);

  while (match) {
    let depth = 0;
    let index = match.index;

    for (; index < source.length; index++) {
      const char = source[index];
      if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === ">" && depth === 0) break;
    }

    tags.push(source.slice(match.index, index + 1));
    match = open.exec(source);
  }

  return tags;
}

/**
 * Read once for the whole file.
 *
 * Both tests below need every `.tsx` under three roots. Reading them per test
 * walked the tree twice, and the extra I/O pushed
 * `lib/auth/require-page-access.test.ts` — which walks `app/` itself — past
 * vitest's 5s default while the two ran in parallel. It failed the suite and
 * passed on its own, which is the most expensive kind of test to debug.
 */
let cached: Promise<[string, string][]> | null = null;

function sources(): Promise<[string, string][]> {
  cached ??= (async () => {
    const files: [string, string][] = [];
    for (const root of ROOTS) {
      for await (const path of walk(root)) {
        if (path.includes("/ui/")) continue;
        if (EXEMPT.some((name) => path.includes(name))) continue;
        files.push([path, await readFile(path, "utf8")]);
      }
    }
    return files;
  })();
  return cached;
}

describe("a link that looks like a button", () => {
  it("is never a Button rendering a Link", async () => {
    const offenders: string[] = [];

    for (const [path, source] of await sources()) {
      for (const tag of buttonTags(source)) {
        if (tag.includes("render={<Link")) offenders.push(path);
      }
    }

    // Named rather than counted: a failure has to say which file to open.
    expect(offenders).toEqual([]);
  });

  it("uses ButtonLink instead, in the places that need one", async () => {
    // Guards the guard. If the scan above stopped matching — a rename, a
    // different import alias — it would pass by finding nothing and quietly
    // protect nothing. These call sites are real and are not going away.
    const users = (await sources()).filter(([, source]) =>
      source.includes("<ButtonLink"),
    );

    expect(users.length).toBeGreaterThan(12);
  });
});
