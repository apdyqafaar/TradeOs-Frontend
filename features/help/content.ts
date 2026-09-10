/**
 * The Help Center's articles, as data.
 *
 * There is no help API — no endpoint in `docs/API-ROUTES.md` serves any of
 * this — so the articles live here and the search in
 * `components/help-center.tsx` runs over this array in the browser. That is
 * the honest shape for a dozen short pages: no request, no loading state, and
 * it works with the counter offline, which is when a cashier is most likely to
 * be looking something up.
 *
 * **Every sentence here describes behaviour that was verified against the
 * running product**, not behaviour that seemed likely. Where the app refuses
 * something, the article says so and says why, because a help page that
 * promises a control the API rejects is worse than no help page. If a
 * behaviour changes, this file changes with it — treat it as documentation
 * that ships, not marketing copy.
 *
 * The rule is that an article about a page a reader cannot open is a support
 * ticket, not help — so this file grew when those pages did. Reports,
 * projects, announcements, team management and settings were all deliberately
 * absent while unbuilt, and were written on 2026-09-10 when their screens
 * shipped. `components/help-center.test.tsx` fails if a shipped area has no
 * article, so the Help Center cannot quietly fall a slice behind again.
 */

export type HelpSection = "counter" | "money" | "stock" | "business" | "people";

/**
 * One paragraph of an article. `kind` is what the paragraph *is*, not how it
 * looks, so the renderer decides the styling in one place.
 *
 * `note` is for the things a reader most needs to not miss — the refusals and
 * the one-way doors. `steps` is an ordered list.
 */
export type HelpBlock =
  | { kind: "text"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "note"; text: string };

export interface HelpArticle {
  /** Stable, URL-safe, and used as the `?article=` value. Never renumber. */
  id: string;
  title: string;
  section: HelpSection;
  /** One line, shown in the list. Written to answer "is this my question?" */
  summary: string;
  body: HelpBlock[];
  /**
   * Extra words that should match this article in search but do not appear in
   * its prose — what a person calls the thing when they do not know the word
   * the product uses. "till" for the counter, "IOU" for a debt.
   */
  keywords: string[];
}

export const HELP_SECTIONS: { id: HelpSection; label: string }[] = [
  { id: "counter", label: "At the counter" },
  { id: "money", label: "Money owed to you" },
  { id: "stock", label: "Products and stock" },
  { id: "business", label: "Running the business" },
  { id: "people", label: "Your team" },
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "recording-your-first-sale",
    title: "Recording your first sale",
    section: "counter",
    summary: "Ring up items, take payment, and hand over the change.",
    keywords: ["till", "checkout", "cashier", "scan", "barcode", "change"],
    body: [
      {
        kind: "text",
        text: "Open New sale from the sidebar or the Overview. Scan a barcode — the scanner types the code and presses Enter, which adds the line straight away — or search by name and tap the product.",
      },
      {
        kind: "text",
        text: "Tapping the same product again does not add a second line. It adds one to the quantity of the line already there, which is what a repeated scan almost always means.",
      },
      {
        kind: "steps",
        items: [
          "Add the items. Adjust a quantity, a unit price or a line discount if you need to.",
          "Type what the customer handed over into Amount tendered.",
          "Check the second box: it shows Change if they overpaid, or Amount due if they have not covered the bill.",
          "Press Complete sale.",
        ],
      },
      {
        kind: "text",
        text: "If the customer hands over more than the total, that is fine — enter what they actually gave you and the screen works out the change. Recording the real amount is what makes the receipt match the drawer.",
      },
      {
        kind: "note",
        text: "Leaving Amount tendered empty is not the same as a sale paid in full. Type 0 for a sale entirely on credit; the counter will ask you for the amount rather than guess.",
      },
    ],
  },
  {
    id: "selling-on-credit",
    title: "Selling on credit",
    section: "counter",
    summary: "When a customer pays part of the bill, or none of it.",
    keywords: ["credit", "owe", "iou", "debt", "later", "instalment"],
    body: [
      {
        kind: "text",
        text: "If the amount tendered leaves a balance, the sale becomes a debt. The counter asks for a customer and a due date before it will let you finish, because a balance with nobody attached to it is money you cannot chase.",
      },
      {
        kind: "text",
        text: 'You can add a note as well — "pays on delivery day" — which stays on the debt.',
      },
      {
        kind: "text",
        text: "When the sale is done, the receipt links straight to the debt it opened, and the debt appears under Debts against that customer's name.",
      },
      {
        kind: "note",
        text: "A due date cannot be in the past, and it is read in your business's own timezone rather than the device's.",
      },
    ],
  },
  {
    id: "fixing-a-mistake-at-the-counter",
    title: "Fixing a mistake at the counter",
    section: "counter",
    summary: "Voiding a sale, and the one time you cannot.",
    keywords: ["void", "cancel", "refund", "undo", "delete", "wrong"],
    body: [
      {
        kind: "text",
        text: "A sale is never deleted. Open the receipt and press Void, giving a reason. The stock goes back for anything you track, a debt the sale opened is cancelled, and the receipt stays on the record marked as voided, with your reason, your name and the time.",
      },
      {
        kind: "text",
        text: "Keeping the voided receipt is deliberate. A record that can disappear is a record nobody can rely on when there is a disagreement.",
      },
      {
        kind: "note",
        text: "Once a payment has been taken against the debt a credit sale opened, the sale can no longer be voided. Deal with the payment first — void the payment on the debt, then void the sale.",
      },
    ],
  },
  {
    id: "taking-two-currencies",
    title: "Taking a second currency",
    section: "money",
    summary: "How the exchange rate is applied, and what the receipt records.",
    keywords: ["currency", "exchange", "dollars", "rate", "forex", "usd"],
    body: [
      {
        kind: "text",
        text: "Your business keeps its books in one main currency and can accept one other at the counter. Switch between them with the toggle above Amount tendered; the line beside it always spells out the rate in force.",
      },
      {
        kind: "text",
        text: "Totals, balances and reports are always in your main currency. Only what the customer physically handed over is recorded in the currency they paid in.",
      },
      {
        kind: "note",
        text: "The rate is frozen onto the sale at the moment you complete it. Changing your rate later never rewrites an old receipt.",
      },
    ],
  },
  {
    id: "collecting-a-debt",
    title: "Collecting what you are owed",
    section: "money",
    summary: "Recording payments against a debt, and closing it out.",
    keywords: ["payment", "collect", "pay", "settle", "balance", "owing"],
    body: [
      {
        kind: "text",
        text: "Open the debt and press Record payment. Enter what you received — Pay in full fills in the exact balance — and the screen shows what will still be owed afterwards before you commit to it.",
      },
      {
        kind: "text",
        text: "When the balance reaches zero the debt closes itself and its status becomes Paid. You do not have to close it by hand.",
      },
      {
        kind: "note",
        text: "You cannot record a payment larger than the balance. If a customer hands over more than they owe, take the balance here and treat the rest as what it is — change, or a payment against a different debt.",
      },
      {
        kind: "text",
        text: "A payment recorded in error can be voided from the debt's payment list. Voiding it puts the balance back and reopens the debt if it had closed.",
      },
    ],
  },
  {
    id: "writing-off-a-debt",
    title: "Writing off a debt",
    section: "money",
    summary: "When the money is not coming, and what the record keeps.",
    keywords: ["write off", "bad debt", "forgive", "cancel", "unrecoverable"],
    body: [
      {
        kind: "text",
        text: "Write off records that you have stopped expecting the remaining balance. The debt closes, the amount written off is kept separately from the amount paid, and payments already taken stay exactly as they were.",
      },
      {
        kind: "note",
        text: "A written-off debt cannot take further payments. Only write one off when you have genuinely given up on it — this is a door that does not open again.",
      },
    ],
  },
  {
    id: "importing-products",
    title: "Importing products from a spreadsheet",
    section: "stock",
    summary: "Bring an existing product list in instead of typing it out.",
    keywords: [
      "import",
      "csv",
      "excel",
      "xlsx",
      "spreadsheet",
      "bulk",
      "upload",
    ],
    body: [
      {
        kind: "text",
        text: "Products → Import takes a CSV or XLSX file of up to 2,000 rows and 5 MB. Download the template if you want the headings we recognise, though your own headings are matched against them automatically.",
      },
      {
        kind: "steps",
        items: [
          "Upload the file. Anything we could not place is listed for you rather than silently dropped.",
          "Check the column mapping — each of your headings, and the field it feeds.",
          "Work through the rows that need attention. Fix a row, or skip it.",
          "Resolve any barcode conflicts, then commit.",
        ],
      },
      {
        kind: "text",
        text: "A conflict means the barcode already belongs to a product you stock. Compare shows the existing product beside the row from your file, so you can see exactly what would change before choosing Skip or Update existing.",
      },
      {
        kind: "note",
        text: "Row numbers in the review table are your spreadsheet's line numbers, so line 1 is your heading row. Nothing is written to your products until you commit.",
      },
      {
        kind: "note",
        text: "An import and its record are removed seven days after the file was uploaded. The products it created stay; the record of the import does not, so export anything you need to keep before then.",
      },
    ],
  },
  {
    id: "restocking-and-adjusting",
    title: "Restocking and adjusting stock",
    section: "stock",
    summary: "Two different actions, and why the difference matters.",
    keywords: ["restock", "adjust", "stock", "inventory", "count", "shrinkage"],
    body: [
      {
        kind: "text",
        text: "Restock adds to what you have on hand — a delivery arrived. Adjust corrects the number in either direction and always asks for a reason: breakage, theft, a recount that disagreed with the shelf.",
      },
      {
        kind: "text",
        text: "Every change is kept. A product's page lists each movement with what changed, what the quantity became afterwards, and when.",
      },
      {
        kind: "note",
        text: "Not everything you sell has to be stocked. A service — delivery, phone charging, repairs — can be untracked, and then selling it never touches a stock figure.",
      },
    ],
  },
  {
    id: "categories",
    title: "Organising products into categories",
    section: "stock",
    summary: "How categories work, and the one you cannot remove.",
    keywords: ["category", "categories", "group", "general", "organise"],
    body: [
      {
        kind: "text",
        text: "Every product belongs to a category. A new business starts with four, and you can add, rename and delete your own from Products → Categories.",
      },
      {
        kind: "note",
        text: "General cannot be deleted. It is where a product lands when no category is given, so removing it would leave products with nowhere to sit.",
      },
      {
        kind: "text",
        text: "A category still holding products cannot be deleted either. Each row shows how many products it holds, so you can see what a delete would cost before you try it.",
      },
    ],
  },
  {
    id: "who-can-do-what",
    title: "Who can do what",
    section: "people",
    summary: "Why a teammate sees fewer things than you do.",
    keywords: [
      "permission",
      "role",
      "seller",
      "manager",
      "owner",
      "access",
      "hidden",
    ],
    body: [
      {
        kind: "text",
        text: "What someone can do is decided by their role. A Seller works the counter — products, customers, sales and taking payments. A Manager runs the business day to day. An Owner can do everything.",
      },
      {
        kind: "text",
        text: "People do not see controls they cannot use. If a teammate says a button is missing rather than greyed out, that is the product working as intended — a control that is visible but always refuses is a worse experience than one that was never offered.",
      },
      {
        kind: "note",
        text: "A change to someone's role takes effect on their very next action. There is nothing to sign out of and back into.",
      },
    ],
  },
  {
    id: "inviting-a-teammate",
    title: "Inviting someone to your business",
    section: "people",
    summary: "Sending an invitation, and what removing someone actually does.",
    keywords: ["invite", "add", "staff", "employee", "join", "remove", "fire"],
    body: [
      {
        kind: "text",
        text: "Members → Invite takes an email address and the role they should have. They appear in the list straight away as Invited, and become Active when they accept and set their password.",
      },
      {
        kind: "text",
        text: "An invitation that goes astray can be sent again from the row's menu. The list shows the date you invited them, which is the only date a pending row has.",
      },
      {
        kind: "note",
        text: "Removing someone is permanent from the list's point of view — they disappear from it and from the count, and there is no view of former staff to bring them back from. What they did stays: their sales, their stock movements and the payments they took all keep their name.",
      },
      {
        kind: "text",
        text: "There is no way to hand the business to someone else. The owner is fixed for the life of the business.",
      },
    ],
  },
  {
    id: "roles-and-permissions",
    title: "Making your own roles",
    section: "people",
    summary: "Building a role that fits how your shop actually works.",
    keywords: ["role", "custom", "permission", "matrix", "manager", "delete"],
    body: [
      {
        kind: "text",
        text: "Members → Roles lists every role with how many people hold it. Add your own and tick exactly what it may do — a night-shift role that sells and takes payments but cannot touch prices, for instance.",
      },
      {
        kind: "note",
        text: "A role somebody holds cannot be deleted. The count beside it is what stands in the way, so move those people to another role first and the count drops to zero.",
      },
      {
        kind: "text",
        text: "The Owner role cannot be edited or deleted. It is the one role that always has everything, which is what makes it safe to experiment with the others.",
      },
    ],
  },
  {
    id: "reading-your-reports",
    title: "Reading your reports",
    section: "business",
    summary: "Choosing a period, and what each figure is actually counting.",
    keywords: [
      "report",
      "revenue",
      "profit",
      "margin",
      "period",
      "export",
      "print",
    ],
    body: [
      {
        kind: "text",
        text: "Reports has six views — an overview and then Sales, Products, Debts, Customers and Staff. The period you pick carries across all of them, so setting This year on one and clicking to another keeps you in this year.",
      },
      {
        kind: "text",
        text: "Every period is worked out in your business's timezone, not your device's, and the bar says which one that is. An owner reading a Nairobi shop from another country sees the shop's day, not their own.",
      },
      {
        kind: "note",
        text: "Revenue counts a credit sale in full on the day it was rung up, whether or not the money has arrived. What actually came in is Collected. The two are different numbers on purpose.",
      },
      {
        kind: "note",
        text: "On the Staff report, Collected means debt repayments that person received. It is not the cash they took at the till, so it is normally much smaller than their revenue.",
      },
      {
        kind: "text",
        text: "In a top-ten list, the share beside a row is its share of the ten shown — not of everything you sold. The panel says so above the list.",
      },
      {
        kind: "note",
        text: "A range can cover at most 366 days, and there is no All time. Reports cannot be exported or printed to a file yet.",
      },
    ],
  },
  {
    id: "debts-report-right-now",
    title: "Why some debt figures ignore the period",
    section: "business",
    summary:
      "Four numbers on the debts report are about today, not the period.",
    keywords: [
      "debt",
      "outstanding",
      "overdue",
      "period",
      "today",
      "right now",
    ],
    body: [
      {
        kind: "text",
        text: "Outstanding, Open debts, Overdue and Overdue amount describe where you stand right now. They do not change when you change the period, because there is no such thing as what you were owed “last month” — you are owed what you are owed today.",
      },
      {
        kind: "text",
        text: "New debt, Collected and Written off do move with the period. Those are things that happened inside the dates you chose.",
      },
      {
        kind: "note",
        text: "The two groups are shown under separate headings for exactly this reason. Reading all of them as one month's story is the mistake the layout is there to prevent.",
      },
    ],
  },
  {
    id: "sharing-a-project",
    title: "Sharing a project with a client",
    section: "business",
    summary:
      "Publishing a page a customer can open, and the link you only see once.",
    keywords: ["project", "client", "share", "link", "publish", "public"],
    body: [
      {
        kind: "text",
        text: "A project holds the progress and the updates for a job you are doing for someone. Publishing it produces a link that anybody holding it can open — no account, no password.",
      },
      {
        kind: "note",
        text: "The link is shown once, at the moment you publish. Copy it then. It is not stored anywhere we can read back, so leaving the page or refreshing loses it, and the screen tells you when that has happened.",
      },
      {
        kind: "text",
        text: "If you lose it, New link makes another one. That also stops every link you have already given out from working, so only do it if you are ready to send the new one to everybody.",
      },
      {
        kind: "note",
        text: "Unpublishing takes the page down immediately. Anyone opening the old link after that gets nothing — there is no grace period.",
      },
    ],
  },
  {
    id: "posting-an-announcement",
    title: "Posting a notice for your team",
    section: "business",
    summary: "Announcements, pinning, and who sees them.",
    keywords: ["announcement", "notice", "post", "pin", "news", "team"],
    body: [
      {
        kind: "text",
        text: "Announcements is a noticeboard everybody in the business can read. Write one, optionally give it a cover image, and it appears at the top of the feed with your name and when you posted it.",
      },
      {
        kind: "text",
        text: "Pin the ones that should not scroll away — a pinned notice stays above the rest no matter how much is posted after it. Unpin it and it drops back into date order.",
      },
      {
        kind: "note",
        text: "There is no search here. The feed is paged, so an old notice is found by turning pages rather than by typing.",
      },
    ],
  },
  {
    id: "business-settings",
    title: "Your business details and currencies",
    section: "business",
    summary:
      "The name on your receipts, your timezone, and the money you take.",
    keywords: [
      "settings",
      "timezone",
      "currency",
      "logo",
      "name",
      "rate",
      "address",
    ],
    body: [
      {
        kind: "text",
        text: "Settings → Business holds the name, phone, address and logo that appear on your receipts and on any project page you share.",
      },
      {
        kind: "note",
        text: "The timezone is not cosmetic. Every report, every receipt time and every daily total is measured in it, so changing it changes what counts as today.",
      },
      {
        kind: "text",
        text: "Settings → Currency sets the one currency you keep your books in, and optionally a second one you accept at the counter with the rate between them. Totals and reports are always in the first; only what a customer physically handed over is recorded in the second.",
      },
      {
        kind: "note",
        text: "Changing the rate never rewrites an old receipt. Each sale keeps the rate that was in force when it was rung up.",
      },
    ],
  },
  {
    id: "your-account-and-security",
    title: "Your account and signing in",
    section: "people",
    summary: "Password, two-factor, and the devices you are signed in on.",
    keywords: [
      "password",
      "account",
      "security",
      "2fa",
      "two-factor",
      "passkey",
      "session",
      "device",
      "email",
    ],
    body: [
      {
        kind: "text",
        text: "Account → Profile is your name and picture. Security is where you change your password and turn on two-factor, which asks for a code from your phone as well as your password.",
      },
      {
        kind: "text",
        text: "Sessions lists the devices you are signed in on. Sign out other devices ends all of them except the one you are using — useful if you have left yourself signed in somewhere you no longer have.",
      },
      {
        kind: "note",
        text: "It is all of them or none: there is no way to sign out one device and leave the rest.",
      },
      {
        kind: "note",
        text: "Your email address cannot be changed. If it needs to be a different one, an owner invites the new address instead.",
      },
      {
        kind: "text",
        text: "Passkeys can be registered and removed here, but signing in with one is not available yet — use your password.",
      },
    ],
  },
];
