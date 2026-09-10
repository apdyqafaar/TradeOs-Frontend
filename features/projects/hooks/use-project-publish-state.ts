"use client";

import { useState } from "react";
import { API_ERROR_CODE, type ApiError } from "@/lib/api/errors";
import type { ObjectId } from "@/lib/api/types";
import {
  usePublishProject,
  useRegenerateShareLink,
  useUnpublishProject,
} from "./use-project-publish";
import { useShareToken } from "./use-share-token";

/**
 * Everything the share card needs, assembled once.
 *
 * The three publish mutations are separate hooks because they are three routes
 * with three different response shapes, but a screen driving them needs one
 * pending flag, one place for a refusal to land, and one rule for the 409. That
 * assembly is here rather than in the component so the component is layout and
 * copy, and so this behaviour can be tested without a DOM.
 *
 * **The 409 is the interesting part.** `POST /publish` on an already-published
 * project is `ALREADY_PUBLISHED` (`project.service.ts:331`) — the feature's only
 * domain conflict — and it is genuinely reachable: two members on the same
 * project, or one double-click. It is **not** shown as a failure, because the
 * state the user asked for is the state the server is in. What it does mean is
 * that *somebody else's* publish minted the token, so this browser will never
 * see it: `conflictResolved` is what lets the card say so instead of leaving a
 * person wondering why no link appeared.
 */
export interface ProjectPublishState {
  /** The token this tab holds, or `undefined`. See `share-token-store.ts`. */
  token: string | undefined;
  publish: (onDone?: () => void) => void;
  unpublish: (onDone?: () => void) => void;
  regenerate: (onDone?: () => void) => void;
  /** Any of the three in flight. */
  busy: boolean;
  /** The last refusal, already turned into something a person can read. */
  issue: string | null;
  clearIssue: () => void;
  /** A publish that came back 409 because it was already done. */
  conflictResolved: boolean;
}

export function useProjectPublishState(
  projectId: ObjectId,
): ProjectPublishState {
  const token = useShareToken(projectId);
  const publishMutation = usePublishProject();
  const unpublishMutation = useUnpublishProject();
  const regenerateMutation = useRegenerateShareLink();

  const [issue, setIssue] = useState<string | null>(null);
  const [conflictResolved, setConflictResolved] = useState(false);

  const clearIssue = () => {
    setIssue(null);
    setConflictResolved(false);
  };

  return {
    token,
    busy:
      publishMutation.isPending ||
      unpublishMutation.isPending ||
      regenerateMutation.isPending,
    issue,
    clearIssue,
    conflictResolved,

    publish: (onDone) => {
      setIssue(null);
      setConflictResolved(false);
      publishMutation.mutate(projectId, {
        onSuccess: () => onDone?.(),
        onError: (error: ApiError) => {
          if (error.code === API_ERROR_CODE.ALREADY_PUBLISHED) {
            // Not a failure — the outcome asked for is the state we are in.
            // The mutation's `onSuccess` never ran, so nothing invalidated the
            // cache; the flag below is what the card explains itself with, and
            // the detail query will pick the real `isPublished` up on its next
            // refetch (which the caller triggers by rendering this state).
            setConflictResolved(true);
            onDone?.();
            return;
          }
          setIssue(shareIssueMessage(error));
        },
      });
    },

    unpublish: (onDone) => {
      setIssue(null);
      setConflictResolved(false);
      unpublishMutation.mutate(projectId, {
        onSuccess: () => onDone?.(),
        // Unpublish never conflicts — unpublishing an unpublished project is a
        // 200 no-op (contract §3.2) — so there is no 409 branch to write here.
        onError: (error: ApiError) => setIssue(shareIssueMessage(error)),
      });
    },

    regenerate: (onDone) => {
      setIssue(null);
      setConflictResolved(false);
      regenerateMutation.mutate(projectId, {
        onSuccess: () => onDone?.(),
        // Regenerate never conflicts either, and it publishes a never-published
        // project as a side effect, so it is safe to fire in any state.
        onError: (error: ApiError) => setIssue(shareIssueMessage(error)),
      });
    },
  };
}

/**
 * A refusal from one of the three publish routes, as something a person can
 * read.
 *
 * Branching on `code`, never on `message` (CLAUDE.md) — except for the 403,
 * where the message *is* the information: nine different conditions share
 * `FORBIDDEN` and only the text tells "you do not have permission" apart from
 * "this business is suspended" (contract §7).
 */
export function shareIssueMessage(error: ApiError): string {
  if (error.code === API_ERROR_CODE.NOT_FOUND) {
    return "This project no longer exists — someone deleted it while this page was open.";
  }
  return error.message;
}
