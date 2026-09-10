"use client";

import { cn } from "cn";
import { ArrowLeft, Info, Search } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import {
  HELP_ARTICLES,
  HELP_SECTIONS,
  type HelpArticle,
  type HelpBlock,
} from "@/features/help/content";

/**
 * Matches an article against what somebody typed.
 *
 * Every term must match something, and a term may match the title, the
 * summary, the body or the article's `keywords` — which exist so that "till"
 * finds the counter article and "IOU" finds the debt one. Requiring all terms
 * rather than any is what makes a two-word search narrow the list instead of
 * widening it, which is the behaviour people expect from a search box even
 * when they could not say so.
 *
 * Exported and pure so the matching can be tested without rendering anything.
 */
export function matchesQuery(article: HelpArticle, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = [
    article.title,
    article.summary,
    ...article.keywords,
    ...article.body.map((block) =>
      block.kind === "steps" ? block.items.join(" ") : block.text,
    ),
  ]
    .join(" ")
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}

function Block({ block }: { block: HelpBlock }) {
  if (block.kind === "steps") {
    return (
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-[14px] text-foreground leading-relaxed marker:font-mono marker:text-muted-2 marker:text-[13px]">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    );
  }

  if (block.kind === "note") {
    return (
      <div className="flex items-start gap-2.5 rounded-[10px] border border-border-strong bg-surface-2 px-3.5 py-3">
        <Info
          className="mt-px size-4 flex-none text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-[13px] text-foreground leading-relaxed">
          {block.text}
        </p>
      </div>
    );
  }

  return (
    <p className="text-[14px] text-foreground leading-relaxed">{block.text}</p>
  );
}

function Article({
  article,
  onBack,
}: {
  article: HelpArticle;
  onBack: () => void;
}) {
  return (
    <div className="flex max-w-[680px] flex-col gap-5">
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-2 rounded-sm text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All articles
      </button>

      <h2 className="font-serif text-3xl text-foreground leading-tight">
        {article.title}
      </h2>

      <div className="flex flex-col gap-4">
        {article.body.map((block, index) => (
          // The blocks of one article are fixed content in a fixed order and
          // never reorder, so the index is a stable identity here.
          // biome-ignore lint/suspicious/noArrayIndexKey: static ordered prose
          <Block key={index} block={block} />
        ))}
      </div>
    </div>
  );
}

/**
 * The Help Center (design canvas artboard `2m`).
 *
 * **Everything is local.** There is no help endpoint in `docs/API-ROUTES.md`,
 * so the articles are a module (`features/help/content.ts`) and the search runs
 * over them in the browser. For a dozen short pages that is the honest shape:
 * no request, no loading state, no empty-state-versus-error question — and it
 * still works when the counter has lost its connection, which is exactly when
 * somebody reaches for help.
 *
 * The open article lives in `?article=` so a link to one can be pasted into a
 * message to a colleague, and so the browser's back button steps out of an
 * article rather than off the page.
 */
export function HelpCenter() {
  const [query, setQuery] = useQueryState(
    "q",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );
  const [articleId, setArticleId] = useQueryState(
    "article",
    parseAsString.withDefault("").withOptions({ history: "push" }),
  );

  const open = HELP_ARTICLES.find((article) => article.id === articleId);

  if (open) {
    return <Article article={open} onBack={() => setArticleId(null)} />;
  }

  const matches = HELP_ARTICLES.filter((article) =>
    matchesQuery(article, query),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="relative max-w-[520px]">
        <Search
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3.5 size-4 text-muted-2"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value || null)}
          placeholder="Search help"
          aria-label="Search help articles"
          className="h-11 w-full rounded-[10px] border border-border bg-card pr-3.5 pl-10 text-[14px] text-foreground outline-none placeholder:text-muted-2 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      {matches.length === 0 ? (
        <div className="rounded-[10px] border border-border bg-card px-5 py-8 text-center">
          <p className="text-[14px] text-foreground">
            Nothing here matches “{query}”.
          </p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Try a shorter search, or the word you would use out loud.
          </p>
        </div>
      ) : (
        HELP_SECTIONS.map((section) => {
          const inSection = matches.filter(
            (article) => article.section === section.id,
          );
          if (inSection.length === 0) return null;

          return (
            <section key={section.id} className="flex flex-col gap-2.5">
              <h2 className="font-medium font-mono text-[11px] text-muted-foreground uppercase tracking-[0.08em]">
                {section.label}
              </h2>
              <ul className="overflow-hidden rounded-[10px] border border-border bg-card">
                {inSection.map((article, index) => (
                  <li key={article.id}>
                    <button
                      type="button"
                      onClick={() => setArticleId(article.id)}
                      className={cn(
                        "flex w-full flex-col gap-1 px-4 py-3.5 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2",
                        index > 0 && "border-border-subtle border-t",
                      )}
                    >
                      <span className="font-medium text-[14px] text-foreground">
                        {article.title}
                      </span>
                      <span className="text-[13px] text-muted-foreground">
                        {article.summary}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
