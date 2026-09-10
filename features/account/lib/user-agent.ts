/**
 * A readable label for a raw `userAgent` string.
 *
 * **This exists only because the API does no parsing.** `GET /auth/sessions`
 * returns the UA exactly as the browser sent it, or `null`
 * (`session.service.ts:115-123`); there is no device, browser or OS field to
 * read (`docs/contracts/settings-account.md` §6). The design draws
 * "Chrome · Windows" (`TradeOs-UI.dc.html:1449`), so the parsing has to happen
 * here or the row shows a 120-character string.
 *
 * ## Deliberately shallow, and deliberately honest about it
 *
 * UA sniffing is a losing game — every browser lies about being every other
 * browser, and the string is frozen or reduced in modern versions. This does
 * the four checks that are reliable *because of* the lying (order matters: Edge
 * claims Chrome, Chrome claims Safari) and then stops.
 *
 * When it cannot tell, it returns `null` and the caller renders the raw string
 * rather than a guess. A session row saying "Unknown browser" would be worse
 * than one showing the UA: the person reading this list is trying to recognise
 * a device, and the raw string at least contains the truth. A confident wrong
 * label is the one outcome that could make someone dismiss a session that is
 * not theirs.
 */

interface Rule {
  label: string;
  test: RegExp;
}

/**
 * Order is the whole algorithm. Edge sends `... Chrome/... Safari/... Edg/...`
 * and Chrome sends `... Safari/...`, so the most specific token has to win, and
 * that means checking the impostors before the browsers they impersonate.
 */
const BROWSERS: Rule[] = [
  { label: "Edge", test: /\bEdg(?:e|A|iOS)?\//i },
  { label: "Opera", test: /\bOPR\/|\bOpera\//i },
  { label: "Samsung Internet", test: /\bSamsungBrowser\//i },
  { label: "Firefox", test: /\bFirefox\/|\bFxiOS\//i },
  // Chrome on iOS is `CriOS`; there is no Chrome engine on iOS, but the person
  // picked the Chrome app and that is what they will recognise in this list.
  { label: "Chrome", test: /\bCriOS\/|\bChrome\//i },
  { label: "Safari", test: /\bSafari\//i },
];

/**
 * iPadOS reports itself as a Mac (`Macintosh; Intel Mac OS X`) with no iPad
 * token at all, so an iPad shows as macOS here. That is wrong and unfixable
 * from the UA string alone — the usual workaround sniffs touch support, which
 * needs the device, not a server-recorded string.
 */
const PLATFORMS: Rule[] = [
  { label: "Windows", test: /\bWindows NT\b/i },
  { label: "Android", test: /\bAndroid\b/i },
  { label: "iPhone", test: /\biPhone\b/i },
  { label: "iPad", test: /\biPad\b/i },
  { label: "macOS", test: /\bMac OS X\b|\bMacintosh\b/i },
  { label: "Linux", test: /\bLinux\b|\bX11\b/i },
];

export interface DeviceLabel {
  /** `"Chrome · Windows"`, or `null` when nothing matched. */
  label: string | null;
  /** The raw string, for the caller to fall back to. `null` if the API sent none. */
  raw: string | null;
}

const match = (rules: Rule[], value: string): string | null =>
  rules.find((rule) => rule.test.test(value))?.label ?? null;

export function describeUserAgent(userAgent: string | null): DeviceLabel {
  if (!userAgent || userAgent.trim() === "") return { label: null, raw: null };

  const browser = match(BROWSERS, userAgent);
  const platform = match(PLATFORMS, userAgent);

  if (browser && platform)
    return { label: `${browser} · ${platform}`, raw: userAgent };
  // One half is still a useful label — "Android" alone narrows a list of four
  // sessions down to one far more often than nothing does.
  if (browser || platform)
    return { label: browser ?? platform, raw: userAgent };

  return { label: null, raw: userAgent };
}
