import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { ReviewAnswerList, ReviewSplit } from "@/app/(app)/review/review-split";
import type { ReviewOpenAction } from "@/lib/money-flow/review-page";
import {
  applyReviewAnswer,
  inspectorIsOpen,
  selectReviewRow,
  selectionAfterAnswer,
} from "@/lib/money-flow/review-inspector";

const orphanActions: ReviewOpenAction[] = [
  { id: "confirm-as-transfer", label: "Confirm as transfer", role: "primary", enabled: true },
  { id: "confirm-as-loan", label: "Confirm as loan", role: "primary", enabled: true },
  { id: "keep-as-money", label: "Keep as spending", role: "secondary", enabled: true },
];

const rows = [
  {
    id: "transfer-a",
    group: "Transfers",
    dateLabel: "21 Oct",
    title: "Transfer to J Nguyen",
    caption: "No matching deposit",
    amountLabel: "-$250.00",
  },
  {
    id: "transfer-b",
    group: "Transfers",
    dateLabel: "19 Oct",
    title: "Transfer to Mum",
    caption: "No matching deposit",
    amountLabel: "-$120.00",
  },
];

function inspectorFor(title: string) {
  return createElement(
    "div",
    null,
    createElement("h2", null, title),
    createElement(ReviewAnswerList, { actions: orphanActions, onAction: () => undefined }),
    createElement("label", null, "Apply to 2 similar"),
  );
}

describe("review side inspector", () => {
  it("selecting a row opens the inspector", () => {
    const closed = renderToStaticMarkup(
      createElement(ReviewSplit, {
        status: "ready",
        rows,
        selectedId: null,
        onSelect: () => undefined,
        onClose: () => undefined,
        inspector: inspectorFor("Transfer to J Nguyen"),
      }),
    );
    assert.match(closed, /Pick a row to answer it/);
    assert.equal(closed.includes("Confirm as transfer"), false);
    assert.match(closed, /data-inspector-open="false"/);

    const opened = selectReviewRow("transfer-a");
    assert.equal(inspectorIsOpen(opened), true);
    assert.equal(opened.selectedId, "transfer-a");

    const html = renderToStaticMarkup(
      createElement(ReviewSplit, {
        status: "ready",
        rows,
        selectedId: opened.selectedId,
        onSelect: () => undefined,
        onClose: () => undefined,
        inspector: inspectorFor("Transfer to J Nguyen"),
      }),
    );
    assert.match(html, /data-inspector-open="true"/);
    assert.match(html, /data-review-sheet="true"/);
    assert.match(html, /data-row-id="transfer-a" data-selected="true"/);
    assert.match(html, /bg-accent-surface/);
    assert.match(html, /bg-primary/);
    assert.match(html, /shadow-card/);
    assert.match(html, /Confirm as transfer/);
    assert.match(html, /Confirm as loan/);
    assert.match(html, /Apply to 2 similar/);
    assert.match(html, /No matching deposit/);
  });

  it("answering a row moves to the next one", () => {
    const ids = ["transfer-a", "transfer-b", "refund-c"];
    assert.equal(selectionAfterAnswer(ids, ["transfer-a"]), "transfer-b");
    const moved = applyReviewAnswer(ids, "transfer-a");
    assert.equal(moved.selectedId, "transfer-b");
    assert.equal(moved.open, true);

    const html = renderToStaticMarkup(
      createElement(ReviewSplit, {
        status: "ready",
        rows,
        selectedId: moved.selectedId,
        onSelect: () => undefined,
        onClose: () => undefined,
        inspector: inspectorFor("Transfer to Mum"),
      }),
    );
    assert.match(html, /data-row-id="transfer-b" data-selected="true"/);
    assert.match(html, /data-row-id="transfer-a" data-selected="false"/);
    assert.match(html, /Transfer to Mum/);
    assert.equal(html.includes("data-row-id=\"transfer-a\" data-selected=\"true\""), false);

    assert.equal(applyReviewAnswer(["only"], "only").selectedId, null);
    assert.equal(selectionAfterAnswer(ids, ["transfer-a", "transfer-b"]), "refund-c");
  });

  it("shows All caught up, skeleton rows, and an inline panel error", () => {
    const empty = renderToStaticMarkup(
      createElement(ReviewSplit, {
        status: "ready",
        rows: [],
        selectedId: null,
        onSelect: () => undefined,
        onClose: () => undefined,
        inspector: null,
        empty: { title: "All caught up", body: "Open is clear." },
      }),
    );
    assert.match(empty, /data-review-empty/);
    assert.match(empty, /All caught up/);

    const loading = renderToStaticMarkup(
      createElement(ReviewSplit, {
        status: "loading",
        rows: [],
        selectedId: null,
        onSelect: () => undefined,
        onClose: () => undefined,
        inspector: null,
      }),
    );
    assert.match(loading, /data-review-skeleton/);
    assert.match(loading, /Loading your items…/);

    const error = renderToStaticMarkup(
      createElement(ReviewSplit, {
        status: "ready",
        rows,
        selectedId: null,
        onSelect: () => undefined,
        onClose: () => undefined,
        inspector: null,
        error: "We couldn’t load your review items",
        onRetry: () => undefined,
      }),
    );
    assert.match(error, /data-review-error/);
    assert.match(error, /We couldn’t load your review items/);
    assert.match(error, /Nothing you’ve answered is lost/);
    assert.match(error, />Retry</);
  });

  it("keeps the review screen on Demo-mode copy and the inspector colours", () => {
    const view = readFileSync(new URL("../../app/(app)/review/review-view.tsx", import.meta.url), "utf8");
    const split = readFileSync(new URL("../../app/(app)/review/review-split.tsx", import.meta.url), "utf8");
    const source = `${view}\n${split}`;
    assert.match(view, /selectReviewRow/);
    assert.match(view, /applyReviewAnswer/);
    assert.match(view, /All caught up/);
    assert.doesNotMatch(source, /Guest|Core tier|Free tier/i);
    assert.doesNotMatch(source, /data stays in your browser/i);
    assert.doesNotMatch(source, /orange|text-negative|bg-attention|text-attention|#f[0-9a-f]{2}[0-4]/i);
    assert.match(split, /bg-accent-surface/);
    assert.match(split, /shadow-card/);
    assert.match(split, /min-h-11/);
  });
});
