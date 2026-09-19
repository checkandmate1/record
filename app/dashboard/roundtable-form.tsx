"use client";

import { useId, useState, useRef } from "react";

interface SideState {
  id: string | null;
  label: string;
  authorIds: string[];
}

interface TurnState {
  sideIndex: number;
  body: string;
}

interface AvailableUser {
  id: string;
  name: string;
}

interface RoundTableFormProps {
  action: (formData: FormData) => Promise<void>;
  defaultPrompt: string;
  initialSides: SideState[];
  initialTurns: TurnState[];
  availableUsers: AvailableUser[];
}

export function RoundTableForm({
  action,
  defaultPrompt,
  initialSides,
  initialTurns,
  availableUsers,
}: RoundTableFormProps) {
  const [sides, setSides] = useState<SideState[]>(
    initialSides.length === 2
      ? initialSides
      : [
          { id: null, label: "Side A", authorIds: [] },
          { id: null, label: "Side B", authorIds: [] },
        ]
  );
  // Coerce any legacy turns to strict alternation: index 0 → side 0, 1 → 1, 2 → 0, ...
  const [turns, setTurns] = useState<TurnState[]>(
    initialTurns.map((t, i) => ({ ...t, sideIndex: i % 2 }))
  );
  // Prefix for the ids that tie each repeated label to its control.
  const fieldId = useId();

  function updateSideLabel(i: number, label: string) {
    setSides(sides.map((s, idx) => (idx === i ? { ...s, label } : s)));
  }

  function addSideAuthor(i: number, userId: string) {
    setSides(
      sides.map((s, idx) => {
        if (idx !== i) return s;
        if (s.authorIds.includes(userId)) return s;
        // Also remove from any other side (a user can only be on one side at a time)
        return { ...s, authorIds: [...s.authorIds, userId] };
      }).map((s, idx) => {
        if (idx === i) return s;
        return { ...s, authorIds: s.authorIds.filter((u) => u !== userId) };
      })
    );
  }

  function removeSideAuthor(i: number, userId: string) {
    setSides(
      sides.map((s, idx) =>
        idx === i ? { ...s, authorIds: s.authorIds.filter((u) => u !== userId) } : s
      )
    );
  }

  const userById = new Map(availableUsers.map((u) => [u.id, u]));

  function addTurn() {
    // Side alternates strictly: next turn's side is determined by current count.
    const sideIndex = turns.length % 2;
    setTurns([...turns, { sideIndex, body: "" }]);
  }

  function removeLastTurn() {
    setTurns(turns.slice(0, -1));
  }

  function updateTurnBody(index: number, body: string) {
    setTurns(turns.map((t, i) => (i === index ? { ...t, body } : t)));
  }

  return (
    <form action={action} className="mt-8 space-y-10">
      {/* Prompt */}
      <div>
        <label htmlFor="rt-prompt" className="block font-headline text-[13px] font-semibold tracking-[0.08em] uppercase text-caption mb-2">
          Prompt
        </label>
        <textarea
          id="rt-prompt"
          name="prompt"
          required
          rows={2}
          maxLength={500}
          defaultValue={defaultPrompt}
          className="w-full border border-ink/20 px-4 py-3 font-headline text-[18px] leading-snug placeholder:text-caption/30 outline-none focus:border-ink transition-colors resize-y"
        />
      </div>

      {/* Sides */}
      <div>
        <h3 className="font-headline text-[18px] font-bold tracking-wide mb-3">Sides</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {sides.map((side, i) => {
            const takenIds = new Set(side.authorIds);
            const otherSideIds = new Set(
              sides.filter((_, idx) => idx !== i).flatMap((s) => s.authorIds)
            );
            const searchable = availableUsers.filter(
              (u) => !takenIds.has(u.id) && !otherSideIds.has(u.id)
            );
            return (
              <div key={i} className="border border-ink/10 p-5">
                <label htmlFor={`${fieldId}-side-${i}-label`} className="block font-headline text-[12px] font-semibold tracking-[0.08em] uppercase text-caption mb-2">
                  Side {i + 1} Label
                </label>
                <input
                  id={`${fieldId}-side-${i}-label`}
                  type="text"
                  value={side.label}
                  onChange={(e) => updateSideLabel(i, e.target.value)}
                  maxLength={80}
                  placeholder={`Side ${i + 1}`}
                  className="w-full border border-ink/20 px-3 py-2 font-headline text-[15px] tracking-wide outline-none focus:border-ink transition-colors"
                />
                <input type="hidden" name={`side_${i}_id`} value={side.id ?? ""} />
                <input type="hidden" name={`side_${i}_label`} value={side.label} />
                <input
                  type="hidden"
                  name={`side_${i}_authors`}
                  value={side.authorIds.join(",")}
                />

                <p className="mt-4 font-headline text-[12px] font-semibold tracking-[0.08em] uppercase text-caption mb-2">
                  Authors
                </p>

                {side.authorIds.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {side.authorIds.map((uid) => {
                      const u = userById.get(uid);
                      if (!u) return null;
                      return (
                        <div
                          key={uid}
                          className="flex items-center justify-between gap-2 bg-neutral-50 px-3 py-1.5"
                        >
                          <span className="font-headline text-[14px] tracking-wide">
                            {u.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeSideAuthor(i, uid)}
                            className="cursor-pointer text-caption/40 hover:text-maroon transition-colors text-[18px] px-1"
                            aria-label={`Remove ${u.name} from side ${i + 1}`}
                            title="Remove author"
                          >
                            &times;
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <SideAuthorSearch
                  users={searchable}
                  onSelect={(u) => addSideAuthor(i, u.id)}
                />
              </div>
            );
          })}
        </div>
        <input type="hidden" name="side_count" value={sides.length} />
      </div>

      {/* Turns */}
      <div>
        <div className="flex items-baseline justify-between">
          <h3 className="font-headline text-[18px] font-bold tracking-wide">Arguments</h3>
          <p className="font-headline text-[12px] text-caption">
            {turns.length} {turns.length === 1 ? "turn" : "turns"}
          </p>
        </div>

        <p className="mt-1 font-headline text-[12px] text-caption">
          {sides[0].label} always goes first; sides alternate.
        </p>

        {turns.length === 0 ? (
          <p className="mt-3 font-headline text-[13px] text-caption italic">
            No arguments yet. Use the button below to add the first turn.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {turns.map((turn, i) => {
              const side = sides[turn.sideIndex] ?? sides[0];
              const isLast = i === turns.length - 1;
              return (
                <div key={i} className="border border-ink/10 p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-baseline gap-3">
                      <span className="font-headline text-[13px] font-bold tracking-[0.08em] uppercase">
                        {side.label}
                      </span>
                      <span className="font-headline text-[12px] text-caption">
                        Turn {i + 1}
                      </span>
                    </div>
                    {isLast && (
                      <button
                        type="button"
                        onClick={removeLastTurn}
                        className="cursor-pointer text-caption/40 hover:text-maroon transition-colors text-[18px] px-2"
                        aria-label="Remove last turn"
                        title="Remove last turn"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                  <label htmlFor={`${fieldId}-turn-${i}`} className="sr-only">
                    {side.label} turn {i + 1}
                  </label>
                  <textarea
                    id={`${fieldId}-turn-${i}`}
                    value={turn.body}
                    onChange={(e) => updateTurnBody(i, e.target.value)}
                    rows={4}
                    placeholder={`What does ${side.label} say?`}
                    className="w-full border border-ink/20 px-3 py-2 font-body text-[15px] leading-relaxed placeholder:text-caption/30 outline-none focus:border-ink transition-colors resize-y"
                  />
                  <input type="hidden" name={`turn_${i}_side`} value={turn.sideIndex} />
                  <input type="hidden" name={`turn_${i}_body`} value={turn.body} />
                </div>
              );
            })}
          </div>
        )}
        <input type="hidden" name="turn_count" value={turns.length} />

        <div className="mt-4">
          <button
            type="button"
            onClick={addTurn}
            className="cursor-pointer font-headline text-[13px] tracking-wide border border-ink/20 px-4 py-2 hover:border-ink hover:bg-neutral-50 transition-colors"
          >
            + Add {sides[turns.length % 2].label} turn
          </button>
        </div>
      </div>

      <div className="pt-4 border-t border-rule">
        <button
          type="submit"
          className="cursor-pointer font-headline font-bold text-[15px] tracking-[0.04em] bg-ink text-white px-8 py-3 hover:bg-maroon transition-colors"
        >
          Save changes
        </button>
      </div>
    </form>
  );
}

function SideAuthorSearch({
  users,
  onSelect,
}: {
  users: AvailableUser[];
  onSelect: (user: AvailableUser) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const searchId = useId();

  const filtered = query.length > 0
    ? users.filter((u) => u.name.toLowerCase().includes(query.toLowerCase()))
    : users;

  return (
    <div ref={ref} className="relative">
      <label htmlFor={searchId} className="sr-only">
        Search for an author to add
      </label>
      <input
        id={searchId}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search for an author to add..."
        className="w-full border border-ink/20 px-3 py-2 font-headline text-[14px] tracking-wide placeholder:text-caption/30 outline-none focus:border-ink transition-colors"
      />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-ink/15 shadow-[0_4px_16px_rgba(0,0,0,0.08)] z-20 max-h-48 overflow-y-auto">
          {filtered.map((u) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(u);
                setQuery("");
                setOpen(false);
              }}
              className="cursor-pointer w-full text-left px-3 py-2 font-headline text-[14px] tracking-wide hover:bg-neutral-50 hover:text-maroon transition-colors"
            >
              {u.name}
            </button>
          ))}
        </div>
      )}
      {open && query.length > 0 && filtered.length === 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-ink/15 z-20 px-3 py-2 font-headline text-[13px] text-caption italic">
          No matches.
        </div>
      )}
    </div>
  );
}
