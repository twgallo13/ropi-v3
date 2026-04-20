import { useState } from "react";
import type { SiteVerificationEntry } from "../lib/api";

interface Props {
  entry: SiteVerificationEntry;
  isPrimary: boolean;
  canAct: boolean;
  onMarkLive: (siteKey: string) => Promise<void>;
  onFlag: (siteKey: string, reason: string) => Promise<void>;
  onReverify: (siteKey: string) => Promise<void>;
}

function stateBadge(state: string) {
  switch (state) {
    case "verified_live":
      return (
        <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs font-medium">
          ✅ Verified Live
        </span>
      );
    case "mismatch":
      return (
        <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded text-xs font-medium">
          🔴 Mismatch
        </span>
      );
    case "stale":
      return (
        <span className="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded text-xs font-medium">
          🟡 Stale
        </span>
      );
    case "unverified":
      return (
        <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs font-medium">
          ⬜ Unverified
        </span>
      );
    default:
      return (
        <span className="bg-gray-100 text-gray-800 px-2 py-0.5 rounded text-xs font-medium">
          {state}
        </span>
      );
  }
}

function ImageWithFallback({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 text-gray-400 text-xs ${className || ""}`}
      >
        Image unavailable
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

export default function SiteVerificationCard({
  entry,
  isPrimary,
  canAct,
  onMarkLive,
  onFlag,
  onReverify,
}: Props) {
  const [actionLoading, setActionLoading] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const isUnverified = entry.verification_state === "unverified";

  // Compact pill for unverified entries
  if (isUnverified) {
    return (
      <div className="flex items-center justify-between border rounded px-3 py-2 bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{entry.site_display_name}</span>
          {entry.site_domain && (
            <span className="text-xs text-gray-400">{entry.site_domain}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {stateBadge("unverified")}
          {isPrimary && (
            <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-medium">
              PRIMARY
            </span>
          )}
        </div>
      </div>
    );
  }

  // Full-card for verified/mismatch/stale entries
  const primaryImage = selectedImage || entry.image_url;
  const allImages = [
    ...(entry.image_url ? [entry.image_url] : []),
    ...entry.additional_image_url_parsed,
  ];

  async function handleAction(fn: () => Promise<void>) {
    setActionLoading(true);
    try {
      await fn();
    } finally {
      setActionLoading(false);
    }
  }

  async function handleFlagSubmit() {
    if (!flagReason.trim()) return;
    await handleAction(() => onFlag(entry.site_key, flagReason));
    setFlagOpen(false);
    setFlagReason("");
  }

  return (
    <div
      className={`border rounded bg-white overflow-hidden ${isPrimary ? "ring-2 ring-blue-300" : ""}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{entry.site_display_name}</span>
          {entry.site_domain && (
            <span className="text-xs text-gray-400">{entry.site_domain}</span>
          )}
          {isPrimary && (
            <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-medium">
              PRIMARY
            </span>
          )}
        </div>
        {stateBadge(entry.verification_state)}
      </div>

      {/* Body */}
      <div className="p-4">
        {/* Images section */}
        <div className="flex gap-3 mb-3">
          {/* Primary image */}
          <div className="flex-shrink-0">
            {primaryImage ? (
              <a
                href={primaryImage}
                target="_blank"
                rel="noopener noreferrer"
                title="Open full image in new tab"
              >
                <ImageWithFallback
                  src={primaryImage}
                  alt={`${entry.site_display_name} product`}
                  className="w-32 h-32 object-contain border rounded cursor-pointer hover:opacity-80"
                />
              </a>
            ) : (
              <div className="w-32 h-32 flex items-center justify-center bg-gray-100 text-gray-400 text-xs border rounded">
                No image
              </div>
            )}
          </div>

          {/* Thumbnails for additional images */}
          {allImages.length > 1 && (
            <div className="flex flex-wrap gap-1 content-start">
              {allImages.map((url, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedImage(url)}
                  className={`w-10 h-10 border rounded overflow-hidden flex-shrink-0 ${
                    url === primaryImage
                      ? "ring-2 ring-blue-400"
                      : "hover:ring-1 hover:ring-gray-300"
                  }`}
                >
                  <ImageWithFallback
                    src={url}
                    alt={`Thumbnail ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Product URL */}
        {entry.product_url ? (
          <a
            href={entry.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline break-all"
          >
            {entry.product_url}
          </a>
        ) : (
          <span className="text-xs text-gray-400 italic">No product URL</span>
        )}

        {/* Metadata row */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
          {entry.last_verified_at && (
            <span>
              Last verified:{" "}
              {new Date(entry.last_verified_at).toLocaleDateString()}
            </span>
          )}
          {entry.reviewer_uid && <span>Reviewer: {entry.reviewer_uid}</span>}
        </div>

        {/* Mismatch reason */}
        {entry.verification_state === "mismatch" && entry.mismatch_reason && (
          <div className="mt-2 bg-red-50 border border-red-200 rounded px-3 py-2 text-xs text-red-700">
            <span className="font-medium">Mismatch reason:</span>{" "}
            {entry.mismatch_reason}
          </div>
        )}

        {/* Action buttons — role-gated, only on full-card */}
        {canAct && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
            {(entry.verification_state === "mismatch" ||
              entry.verification_state === "stale") && (
              <button
                onClick={() =>
                  handleAction(() => onMarkLive(entry.site_key))
                }
                disabled={actionLoading}
                className="px-3 py-1 text-xs font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                Mark Live
              </button>
            )}
            {entry.verification_state === "verified_live" && (
              <button
                onClick={() =>
                  handleAction(() => onReverify(entry.site_key))
                }
                disabled={actionLoading}
                className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Confirm Still Live
              </button>
            )}
            {entry.verification_state !== "mismatch" && (
              <button
                onClick={() => setFlagOpen(true)}
                disabled={actionLoading}
                className="px-3 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                Flag Mismatch
              </button>
            )}
          </div>
        )}

        {/* Flag mismatch reason input */}
        {flagOpen && (
          <dialog
            open
            className="mt-2 border rounded bg-white shadow-lg p-3 w-full max-w-sm"
          >
            <p className="text-xs font-medium mb-2">
              Describe the mismatch for {entry.site_display_name}:
            </p>
            <textarea
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              rows={2}
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="e.g. wrong product shown, image doesn't match…"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => {
                  setFlagOpen(false);
                  setFlagReason("");
                }}
                className="px-3 py-1 text-xs border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleFlagSubmit}
                disabled={!flagReason.trim() || actionLoading}
                className="px-3 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                Submit Flag
              </button>
            </div>
          </dialog>
        )}
      </div>
    </div>
  );
}
