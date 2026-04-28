import { useEffect, useRef, useState } from "react";
import {
  fetchComments,
  postComment,
  deleteComment,
  fetchUsers,
  type ProductComment,
  type UserRosterEntry,
} from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { ConfirmModal } from "./admin";

// Module-level cache for users (populated on first load in session)
let USER_CACHE: UserRosterEntry[] | null = null;

function renderWithMentions(text: string, users: UserRosterEntry[]): React.ReactNode {
  // Replace @[name] or @name with a highlight
  const byName = new Map(users.map((u) => [u.display_name.toLowerCase(), u]));
  const parts = text.split(/(\s+)/);
  return parts.map((p, i) => {
    if (p.startsWith("@")) {
      const n = p.slice(1).toLowerCase();
      if (byName.has(n)) {
        return (
          <span key={i} className="text-blue-700 font-medium">
            {p}
          </span>
        );
      }
    }
    return <span key={i}>{p}</span>;
  });
}

export default function ProductCommentThread({ mpn }: { mpn: string }) {
  const { user } = useAuth();
  const [comments, setComments] = useState<ProductComment[]>([]);
  const [users, setUsers] = useState<UserRosterEntry[]>([]);
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [open, setOpen] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // TALLY-SETTINGS-UX Phase 3 / B.0 — ConfirmModal migration
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetchComments(mpn);
      setComments(res.comments);
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed to load comments");
    }
  }

  async function loadUsers() {
    if (USER_CACHE) {
      setUsers(USER_CACHE);
      return;
    }
    try {
      const list = await fetchUsers();
      USER_CACHE = list;
      setUsers(list);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    load();
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpn]);

  function onTextChange(newText: string) {
    setText(newText);
    // Detect @mention in progress
    const cursor = inputRef.current?.selectionStart ?? newText.length;
    const before = newText.slice(0, cursor);
    const match = before.match(/@(\w*)$/);
    if (match) {
      setAutocompleteQuery(match[1].toLowerCase());
      setShowAutocomplete(true);
    } else {
      setShowAutocomplete(false);
    }
  }

  function insertMention(u: UserRosterEntry) {
    const cursor = inputRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursor).replace(/@\w*$/, `@${u.display_name} `);
    const after = text.slice(cursor);
    setText(before + after);
    if (!mentions.includes(u.uid)) setMentions([...mentions, u.uid]);
    setShowAutocomplete(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function handlePost() {
    if (!text.trim()) return;
    setPosting(true);
    setError("");
    try {
      // Recompute mentions from final text against known user roster
      const final: string[] = [];
      for (const u of users) {
        if (text.includes(`@${u.display_name}`)) final.push(u.uid);
      }
      await postComment(mpn, text, final.length > 0 ? final : mentions);
      setText("");
      setMentions([]);
      await load();
    } catch (e: any) {
      setError(e?.error || e?.message || "Failed to post comment");
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleteTargetId(id);
  }

  async function runDelete(id: string) {
    await deleteComment(mpn, id);
    await load();
  }

  const filteredUsers = autocompleteQuery
    ? users
        .filter((u) => u.display_name.toLowerCase().includes(autocompleteQuery))
        .slice(0, 6)
    : users.slice(0, 6);

  return (
    <div className="mt-6 border rounded bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex justify-between items-center px-4 py-2 border-b bg-gray-50 text-sm font-semibold"
      >
        <span>💬 Comments ({comments.length})</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-2 rounded text-sm">
              {error}
            </div>
          )}

          {comments.length === 0 && (
            <p className="text-sm text-gray-500 italic">No comments yet.</p>
          )}

          {comments.map((c) => (
            <div key={c.comment_id} className="border-l-2 border-blue-200 pl-3">
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-medium text-sm">{c.author_name}</span>
                  <span className="text-xs text-gray-500 ml-2">
                    {c.created_at ? new Date(c.created_at).toLocaleString() : ""}
                  </span>
                </div>
                {c.author_uid === user?.uid && (
                  <button
                    onClick={() => handleDelete(c.comment_id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                )}
              </div>
              <div className="text-sm mt-1 whitespace-pre-wrap">
                {renderWithMentions(c.text, users)}
              </div>
            </div>
          ))}

          {/* Composer */}
          <div className="relative">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              rows={3}
              placeholder="Add comment... @mention someone"
              className="w-full border rounded p-2 text-sm"
            />
            {showAutocomplete && filteredUsers.length > 0 && (
              <div className="absolute left-0 bottom-full mb-1 bg-white border rounded shadow z-10 w-64 max-h-48 overflow-y-auto">
                {filteredUsers.map((u) => (
                  <button
                    key={u.uid}
                    onClick={() => insertMention(u)}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center gap-2"
                  >
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center">
                      {u.avatar_initials}
                    </span>
                    <span>{u.display_name}</span>
                    {u.role && <span className="text-xs text-gray-400 ml-auto">{u.role}</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-2">
              <button
                onClick={handlePost}
                disabled={posting || !text.trim()}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded disabled:opacity-50"
              >
                {posting ? "Posting…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmModal
        open={deleteTargetId !== null}
        title="Delete comment?"
        body="This will permanently delete the comment. This action cannot be undone."
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={async () => {
          try {
            await runDelete(deleteTargetId!);
            setDeleteTargetId(null);
            setDeleteError(null);
          } catch (e: any) {
            setDeleteError(e?.error ?? e?.message ?? String(e) ?? "Failed to delete");
          }
        }}
        onCancel={() => {
          setDeleteTargetId(null);
          setDeleteError(null);
        }}
        errorSlot={deleteError}
      />
    </div>
  );
}
