"use client";

import { Check, Copy, Link2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { env } from "@/config/env";
import { ROUTES } from "@/config/routes";
import { formatDateTime } from "@/lib/format/date";
import { useProjectPublishState } from "../hooks/use-project-publish-state";
import type { Project } from "../types";
import { ShareConfirmDialog } from "./share-confirm-dialog";

export interface ShareCardProps {
  project: Project;
  timezone: string;
}

/** How long the Copy button stays in its "Copied" state. */
const COPIED_MS = 2000;

/**
 * "Share with the client" — artboard `2l`, the detail screen's right column.
 *
 * This is the highest-consequence panel in the product, and every decision in
 * it comes from one fact: **the share token is returned exactly once, by the
 * `publish` that mints it.** It is 32 random bytes kept server-side only as a
 * SHA-256 hash (`lib/tokens.ts:4,11-12`, `project.model.ts:31`); no read
 * endpoint returns it, and a `publish` on an already-hashed project answers
 * `shareToken: null` (`project.service.ts:333-338,348`). The only recovery is
 * `regenerate-link`, which invalidates every link a client already has.
 *
 * So the card has **four states**, and telling them apart is its whole job:
 *
 *   1. **Not published.** One button. The copy says what publishing does,
 *      because it is the moment the link is created and the only moment it can
 *      be read.
 *   2. **Published, and this browser holds the token.** The URL in full, a
 *      copy control, and the two ways to break it. This is the state the canvas
 *      draws, and it lasts as long as the tab does.
 *   3. **Published, and this browser does not hold the token.** The canvas has
 *      no drawing for this and it is the *common* state — anyone opening a
 *      project published last week is in it. The card must not render a
 *      placeholder URL, must not invent one, and must not imply the link is
 *      broken: the client's link works fine, it simply cannot be shown here
 *      again. Regenerating is offered as the way out, with its cost stated.
 *   4. **Unpublished after being published.** Same as 1, plus the fact that
 *      publishing again restores the *same* link — which is good news for the
 *      client and bad news for anyone hoping to see the URL again.
 *
 * The whole card is gated on `projects:publish` by its caller. That one
 * permission covers publish, unpublish and regenerate
 * (`project.route.ts:118,127,136`) — there is no finer split to make.
 */
export function ShareCard({ project, timezone }: ShareCardProps) {
  const {
    token,
    publish,
    unpublish,
    regenerate,
    busy,
    issue,
    clearIssue,
    conflictResolved,
  } = useProjectPublishState(project.id);

  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<"regenerate" | "unpublish">();

  const shareUrl = token
    ? // `env.appUrl`, not `window.location.origin`. This URL is going into a
      // message to somebody else, so it has to be the app's configured public
      // origin rather than whatever host this member happens to be using — a
      // preview deployment or an IP address would produce a link that works for
      // nobody. `ROUTES.publicProject` owns the path shape.
      `${env.appUrl}${ROUTES.publicProject(token)}`
    : null;

  const copy = () => {
    if (!shareUrl) return;
    // `navigator.clipboard` is unavailable on an insecure origin and can be
    // refused by permissions policy. The URL is rendered in full above this
    // button precisely so a failed copy degrades to selecting it by hand
    // rather than to a dead end.
    void navigator.clipboard
      ?.writeText(shareUrl)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), COPIED_MS);
      })
      .catch(() => setCopied(false));
  };

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-[18px]">
      <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em]">
        Share with the client
      </span>

      {project.isPublished ? (
        token ? (
          <PublishedWithLink
            shareUrl={shareUrl ?? ""}
            copied={copied}
            onCopy={copy}
          />
        ) : (
          <PublishedWithoutLink />
        )
      ) : (
        <NotPublished
          everPublished={Boolean(project.publishedAt)}
          publishedAt={project.publishedAt}
          timezone={timezone}
        />
      )}

      {issue ? (
        <p
          role="alert"
          className="rounded-[10px] border border-destructive/40 bg-destructive-soft px-3 py-2.5 text-[12px] text-destructive-strong"
        >
          {issue}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {project.isPublished ? (
          <>
            <div className="flex gap-2">
              {shareUrl ? (
                <Button
                  type="button"
                  className="h-[38px] flex-1 rounded-[10px] text-[13px]"
                  onClick={copy}
                >
                  {copied ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                  {copied ? "Copied" : "Copy link"}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  clearIssue();
                  setConfirming("regenerate");
                }}
                className={
                  shareUrl
                    ? "h-[38px] rounded-[10px] px-3 text-[13px]"
                    : "h-[38px] flex-1 rounded-[10px] px-3 text-[13px]"
                }
              >
                {shareUrl ? "Regenerate" : "Create a new link"}
              </Button>
            </div>

            <p className="text-[12px] text-muted-2">
              Regenerating stops the old link working immediately.
            </p>

            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                clearIssue();
                setConfirming("unpublish");
              }}
              className="h-9 rounded-[10px] text-[13px] text-muted-foreground"
            >
              Unpublish
            </Button>
          </>
        ) : (
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              clearIssue();
              publish();
            }}
            className="h-[38px] rounded-[10px] text-[13px]"
          >
            <Link2 className="size-4" aria-hidden="true" />
            {busy ? "Publishing…" : "Publish and get the link"}
          </Button>
        )}
      </div>

      <ShareConfirmDialog
        open={confirming === "regenerate"}
        onOpenChange={(open) => setConfirming(open ? "regenerate" : undefined)}
        title="Create a new link?"
        confirmLabel="Regenerate link"
        busy={busy}
        issue={issue}
        onConfirm={() => {
          regenerate(() => setConfirming(undefined));
        }}
        description={
          <>
            <span>
              Any link you have already sent this client stops working the
              moment you do this. If they have it saved or bookmarked, it will
              show them nothing until you send the new one.
            </span>
            <span>
              The new link is shown here once, straight after. Copy it before
              you leave this page.
            </span>
          </>
        }
      />

      <ShareConfirmDialog
        open={confirming === "unpublish"}
        onOpenChange={(open) => setConfirming(open ? "unpublish" : undefined)}
        title="Stop sharing this project?"
        confirmLabel="Unpublish"
        busy={busy}
        issue={issue}
        onConfirm={() => {
          unpublish(() => setConfirming(undefined));
        }}
        description={
          <>
            <span>
              The page goes down straight away — anyone opening the link sees
              nothing.
            </span>
            {/*
              Both halves are true and neither is obvious. Publishing again
              reuses the same hash, so the client's old link starts working
              again; but that re-publish answers `shareToken: null`, so this
              screen will not be able to show the URL any more.
            */}
            <span>
              Publishing again turns the same link back on. It will not be shown
              here again, though — only a new one can be.
            </span>
            <span>
              Images already loaded from this page keep working: unpublishing
              takes down the page, not the pictures.
            </span>
          </>
        }
      />

      {/*
        A 409 `ALREADY_PUBLISHED` is not a failure — it means somebody else
        published this project first, which is the state the user was asking
        for. The hook refetches and reports it here rather than as an error.
      */}
      {conflictResolved ? (
        <p className="text-[12px] text-muted-foreground">
          Someone else published this project first, so the link below is theirs
          — this browser cannot show it.
        </p>
      ) : null}
    </div>
  );
}

/** State 2 — the canvas's drawing. The URL is visible, not hidden behind Copy. */
function PublishedWithLink({
  shareUrl,
  copied,
  onCopy,
}: {
  shareUrl: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <>
      <p className="text-[13px] text-muted-foreground text-pretty">
        Anyone with this link can follow the project without an account.
      </p>
      {/*
        A real, selectable element rather than a styled span: `navigator.
        clipboard` is unavailable on an insecure origin, so the fallback has to
        be "select the text and copy it yourself". `readOnly` rather than
        `disabled` — a disabled input cannot be selected either.

        `onFocus` selects the whole thing, because the URL is 64 hex characters
        long and dragging across it in a 10px-tall box is miserable.
      */}
      <input
        readOnly
        value={shareUrl}
        aria-label="Public link for this project"
        onFocus={(event) => event.currentTarget.select()}
        onClick={onCopy}
        className="h-10 w-full truncate rounded-[10px] border border-border bg-surface-2 px-3 font-mono text-[12px] text-foreground focus-visible:border-ring focus-visible:outline-none"
      />
      {/*
        `aria-live` so a screen reader hears the copy succeed — the visual
        confirmation is a swapped icon and label on a button that has already
        been pressed, which announces nothing on its own.
      */}
      <span className="sr-only" aria-live="polite">
        {copied ? "Link copied" : ""}
      </span>
    </>
  );
}

/**
 * State 3 — published, but this browser never saw the token.
 *
 * The hard case, and the one the canvas has no drawing for. Three things have
 * to be true at once for the copy to be honest: the client's link works, this
 * screen cannot show it, and the way to get a showable one costs the old one.
 */
function PublishedWithoutLink() {
  return (
    <>
      <p className="text-[13px] text-muted-foreground text-pretty">
        This project is shared. The link still works for anyone holding it — but
        it is stored as a fingerprint only, so it can be shown here just once,
        when it is created.
      </p>
      <p className="rounded-[10px] border border-border bg-surface-2 px-3 py-2.5 text-[12px] text-muted-foreground">
        If you no longer have it, create a new link below. The one the client
        has will stop working.
      </p>
    </>
  );
}

/** States 1 and 4 — nothing is shared right now. */
function NotPublished({
  everPublished,
  publishedAt,
  timezone,
}: {
  everPublished: boolean;
  publishedAt: string | null;
  timezone: string;
}) {
  return (
    <>
      <p className="text-[13px] text-muted-foreground text-pretty">
        Publishing creates a link anyone can open without an account. They see
        the title, description, progress and every update — no prices, no
        contact details, no names.
      </p>
      {everPublished && publishedAt ? (
        /*
          `publishedAt` survives an unpublish and is refreshed on every publish
          and regenerate, so it means "last published at" and NOT "currently
          published" (contract §3.2). Labelled as a past event for that reason —
          calling it "Published" beside a project that is not would be exactly
          wrong.
        */
        <p className="font-mono text-[11px] text-muted-2">
          Last shared {formatDateTime(publishedAt, timezone)}
        </p>
      ) : null}
      {everPublished ? (
        <p className="text-[12px] text-muted-foreground">
          Publishing again turns the previous link back on rather than making a
          new one.
        </p>
      ) : null}
    </>
  );
}
