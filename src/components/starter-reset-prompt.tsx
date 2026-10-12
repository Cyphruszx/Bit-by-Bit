"use client";

/**
 * Amend BV.T.1. Shown only while the stored starter list is older than this build
 * and {@link PRELAUNCH_STARTER_RESET} is still on. Not now is this session only.
 */
export function StarterResetPrompt({
  onReset,
  onDismiss,
}: {
  onReset: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5">
      <div role="alertdialog" aria-labelledby="starter-reset-title" className="card max-w-md p-6">
        <h2 id="starter-reset-title" className="text-lg font-bold">
          Starter categories updated. Reset test data?
        </h2>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onReset}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
