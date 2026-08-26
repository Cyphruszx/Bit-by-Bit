"use client";

import { useState, type ReactNode } from "react";

export function TagEditor({
  tags,
  aiSuggested = false,
  suggestions,
  listId,
  onChange,
}: {
  tags: string[];
  aiSuggested?: boolean;
  suggestions: string[];
  listId: string;
  onChange: (tags: string[]) => void;
}) {
  const primary = tags[0] ?? "Other";
  const subs = tags.slice(1);
  const unused = suggestions.filter((name) => !tags.some((tag) => tag.toLowerCase() === name.toLowerCase()));

  return (
    <div className="mt-3 space-y-2">
      <TagRow label="Primary">
        <TagChip name={primary} tone="primary" onRemove={subs.length > 0 ? () => onChange(subs) : undefined} />
        <TagNameForm
          listId={`${listId}-primary`}
          options={unused}
          placeholder="Change primary"
          submitLabel="Set"
          onSubmit={(name) => onChange([name, ...subs.filter((tag) => tag.toLowerCase() !== name.toLowerCase())])}
        />
      </TagRow>
      <TagRow label="Sub-tag">
        {subs.length === 0 ? <span className="text-xs text-[#77857f]">Optional detail</span> : null}
        {subs.map((tag) => (
          <TagChip
            key={tag}
            name={tag}
            tone="sub"
            onRemove={() => onChange([primary, ...subs.filter((name) => name !== tag)])}
            onMakePrimary={() => onChange([tag, primary, ...subs.filter((name) => name !== tag)])}
          />
        ))}
        <TagNameForm
          listId={`${listId}-sub`}
          options={unused}
          placeholder="Add sub-tag"
          submitLabel="Add"
          onSubmit={(name) => {
            if (name.toLowerCase() === primary.toLowerCase()) return;
            onChange([primary, ...subs, name]);
          }}
        />
      </TagRow>
      {aiSuggested ? (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#527166]">AI suggested primary</p>
      ) : null}
    </div>
  );
}

function TagRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[#77857f]">{label}</span>
      {children}
    </div>
  );
}

function TagChip({
  name,
  tone,
  onRemove,
  onMakePrimary,
}: {
  name: string;
  tone: "primary" | "sub";
  onRemove?: () => void;
  onMakePrimary?: () => void;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
        tone === "primary" ? "bg-[#173b31] text-white" : "bg-[#edf4dc] text-[#355a3f]"
      }`}
    >
      {name}
      {onMakePrimary ? (
        <button type="button" className="text-[10px] font-semibold uppercase tracking-wide opacity-80" onClick={onMakePrimary}>
          Primary
        </button>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className={tone === "primary" ? "text-white/80 hover:text-white" : "text-[#527166] hover:text-[#173b31]"}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

function TagNameForm({
  listId,
  options,
  placeholder,
  submitLabel,
  onSubmit,
}: {
  listId: string;
  options: string[];
  placeholder: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function submit(name: string) {
    const next = name.trim();
    if (!next) return;
    onSubmit(next);
    setDraft("");
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        submit(draft);
      }}
    >
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        list={listId}
        placeholder={placeholder}
        className="w-28 rounded-full border border-[#dce4df] bg-white px-3 py-1 text-xs outline-none focus:border-[#173b31]"
      />
      <button type="submit" className="text-xs font-semibold text-[#355a3f]">
        {submitLabel}
      </button>
      {options.length > 0 ? (
        <select
          value=""
          aria-label={placeholder}
          onChange={(event) => {
            if (event.target.value) submit(event.target.value);
          }}
          className="rounded-full border border-[#dce4df] bg-white px-2 py-1 text-xs outline-none focus:border-[#173b31]"
        >
          <option value="">Existing</option>
          {options.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ) : null}
      <datalist id={listId}>
        {options.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </form>
  );
}
