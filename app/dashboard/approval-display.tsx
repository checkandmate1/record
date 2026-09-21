"use client";

import { useState } from "react";

interface Approver {
  id: string;
  approvalId: string;
  name: string;
  image: string | null;
}

interface ApprovalDisplayProps {
  approvers: Approver[];
  currentUserId: string;
  hasApproved: boolean;
  onApprove: () => Promise<void>;
  onRemoveApproval?: (approvalId: string) => Promise<void>;
  canRemoveOthers: boolean;
}

function Avatar({ name, image, size = 28 }: { name: string; image: string | null; size?: number }) {
  const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  if (image) {
    return (
      <img
        src={image}
        alt={name}
        className="rounded-full border-2 border-white object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="rounded-full border-2 border-white bg-neutral-200 flex items-center justify-center font-headline text-[10px] font-bold text-neutral-600"
      style={{ width: size, height: size }}
    >
      {initials}
    </div>
  );
}

export function ApprovalDisplay({
  approvers,
  currentUserId,
  hasApproved,
  onApprove,
  onRemoveApproval,
  canRemoveOthers,
}: ApprovalDisplayProps) {
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const visibleCount = 3;
  const visible = approvers.slice(0, visibleCount);
  const hasOthers = approvers.length > visibleCount;

  function displayName(a: Approver) {
    return a.id === currentUserId ? "you" : a.name;
  }

  function formatNames() {
    if (approvers.length === 0) return null;
    if (approvers.length === 1) return `Approved by ${displayName(approvers[0])}`;
    if (approvers.length === 2) return `Approved by ${displayName(approvers[0])} and ${displayName(approvers[1])}`;
    return `Approved by ${displayName(approvers[0])}, ${displayName(approvers[1])}, and `;
  }

  async function handleApprove() {
    setLoading(true);
    await onApprove();
    setLoading(false);
  }

  return (
    <div className="flex items-center gap-3">
      {approvers.length > 0 && (
        <div className="flex items-center">
          {visible.map((a, i) => (
            <div
              key={a.id}
              className="relative"
              style={{ marginLeft: i > 0 ? -8 : 0, zIndex: visibleCount - i }}
            >
              <Avatar name={a.name} image={a.image} />
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        <p className="font-headline text-[13px] text-caption tracking-wide">
          {formatNames()}
          {hasOthers && (
            <button
              type="button"
              className="cursor-pointer underline"
              onMouseEnter={() => setShowAll(true)}
              onMouseLeave={() => setShowAll(false)}
            >
              others
            </button>
          )}
        </p>

        {showAll && (
          <div
            className="absolute left-0 top-full mt-1 bg-white border border-ink/15 shadow-[0_4px_16px_rgba(0,0,0,0.1)] z-30 py-2 min-w-[200px]"
            onMouseEnter={() => setShowAll(true)}
            onMouseLeave={() => setShowAll(false)}
          >
            {approvers.map((a) => (
              <div key={a.id} className="flex items-center gap-2 px-3 py-1.5">
                <Avatar name={a.name} image={a.image} size={22} />
                <span className="font-headline text-[13px]">{a.name}</span>
                {canRemoveOthers && onRemoveApproval && (
                  <button
                    type="button"
                    onClick={() => onRemoveApproval(a.approvalId)}
                    className="cursor-pointer ml-auto text-caption/40 hover:text-maroon text-[14px]"
                    aria-label={`Remove ${a.name}’s approval`}
                    title="Remove approval"
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {hasApproved ? (
        <div className="flex items-center gap-2">
          <span className="font-headline text-[12px] font-semibold tracking-wide text-green-700 flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Approved
          </span>
          <button
            type="button"
            onClick={async () => {
              const myApproval = approvers.find((a) => a.id === currentUserId);
              if (myApproval && onRemoveApproval) {
                setLoading(true);
                await onRemoveApproval(myApproval.approvalId);
                setLoading(false);
              }
            }}
            disabled={loading}
            className="cursor-pointer font-headline font-bold text-[12px] tracking-wide border border-red-300 text-red-600 px-3 py-1 hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            {loading ? "..." : "Unapprove"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleApprove}
          disabled={loading}
          className="cursor-pointer font-headline font-bold text-[12px] tracking-wide border border-green-700 text-green-700 px-3 py-1 hover:bg-green-50 transition-colors disabled:opacity-50"
        >
          {loading ? "..." : "Approve"}
        </button>
      )}
    </div>
  );
}
