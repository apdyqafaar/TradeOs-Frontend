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
 * Deliberately absent: anything about reports, projects, announcements, team
 * management or settings. Those screens do not exist yet, and an article about
 * a page a reader cannot open is a support ticket, not help.
 */

export type HelpSection = "counter" | "money" | "stock" | "people";

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
];
