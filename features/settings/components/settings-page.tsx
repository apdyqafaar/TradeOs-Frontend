"use client";

import { cn } from "cn";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { BusinessForm } from "./business-form";
import { CurrencyForm } from "./currency-form";

/**
 * `/settings` — artboard `2k`, left panel
 * (`docs/design/TradeOs-UI.dc.html:1330-1391`).
 *
 * **Tabs, not routes**, unlike `/team` → `/team/roles`. The team screens split
 * because they have two different page permissions and each is server-gated
 * before it renders; both panels here are the same `organization:update` and
 * the same tenant, so a second route would add a second gate that can only ever
 * agree with the first.
 *
 * The selected tab lives in the URL through `nuqs`, per this repo's rule that
 * view state a person would want to link to belongs in the query string and not
 * in a store: `/settings?tab=currency` is a shareable answer to "where do I
 * change the rate", and the back button leaves the tab strip.
 */
const SETTINGS_TABS = ["business", "currency"] as const;

const TAB_LABELS: Record<(typeof SETTINGS_TABS)[number], string> = {
  business: "Business",
  currency: "Currency",
};

const tabParser = parseAsStringLiteral(SETTINGS_TABS).withDefault("business");

export function SettingsPage() {
  const [tab, setTab] = useQueryState("tab", tabParser);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <h1 className="font-serif text-3xl leading-tight text-foreground">
        Settings
      </h1>

      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-6 border-border border-b"
      >
        {SETTINGS_TABS.map((value) => {
          const isActive = value === tab;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              id={`settings-tab-${value}`}
              aria-selected={isActive}
              aria-controls={`settings-panel-${value}`}
              onClick={() => void setTab(value, { history: "push" })}
              className={cn(
                "-mb-px border-b-2 px-0.5 pb-[11px] text-[13px] transition-colors",
                isActive
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {TAB_LABELS[value]}
            </button>
          );
        })}
      </div>

      {/*
        The inactive panel is unmounted rather than hidden. Each form seeds its
        own state from the server on mount and tracks its own dirty flag, so a
        panel kept mounted behind `hidden` would hold edits the person can no
        longer see and cannot discard.
      */}
      <div
        role="tabpanel"
        id={`settings-panel-${tab}`}
        aria-labelledby={`settings-tab-${tab}`}
      >
        {tab === "business" ? <BusinessForm /> : <CurrencyForm />}
      </div>
    </div>
  );
}
