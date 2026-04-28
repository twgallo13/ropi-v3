import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";

/**
 * TALLY-SETTINGS-UX Phase 3 / B.0 — RichTextEditor
 *
 * Shared rich-text editor for B.6 Guided Tours + SOP Panel (future).
 * TipTap + StarterKit. Out of scope for B.0: embeds, mentions, image uploads,
 * tables, advanced features, backend integration.
 */
export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function RichTextEditor({
  value,
  onChange,
  disabled,
  className,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Keep editor in sync if parent resets value externally.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Sync editable when disabled toggles.
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) {
    return (
      <div
        className={[
          "border border-gray-200 dark:border-gray-700 rounded p-2 text-sm text-gray-400",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        Loading editor…
      </div>
    );
  }

  const btnClass = "p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-sm";
  const activeClass = "bg-gray-200 dark:bg-gray-700";

  return (
    <div
      className={[
        "border border-gray-200 dark:border-gray-700 rounded p-2",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 pb-2 mb-2 flex-wrap">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`${btnClass} ${editor.isActive("bold") ? activeClass : ""}`}
          aria-label="Bold"
        >
          <b>B</b>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`${btnClass} ${editor.isActive("italic") ? activeClass : ""}`}
          aria-label="Italic"
        >
          <i>I</i>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`${btnClass} ${editor.isActive("heading", { level: 1 }) ? activeClass : ""}`}
          aria-label="Heading 1"
        >
          H1
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`${btnClass} ${editor.isActive("heading", { level: 2 }) ? activeClass : ""}`}
          aria-label="Heading 2"
        >
          H2
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`${btnClass} ${editor.isActive("heading", { level: 3 }) ? activeClass : ""}`}
          aria-label="Heading 3"
        >
          H3
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`${btnClass} ${editor.isActive("bulletList") ? activeClass : ""}`}
          aria-label="Bullet list"
        >
          • List
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`${btnClass} ${editor.isActive("orderedList") ? activeClass : ""}`}
          aria-label="Ordered list"
        >
          1. List
        </button>
      </div>
      <EditorContent editor={editor} className="prose prose-sm dark:prose-invert max-w-none" />
    </div>
  );
}

export default RichTextEditor;
