import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteProduct } from "../lib/api";

interface Props {
  mpn: string;
  productName?: string;
}

export default function DeleteProductButton({ mpn, productName }: Props) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteProduct(mpn);
      navigate("/queue/completion");
    } catch (err: any) {
      alert(
        "Delete failed: " + (err?.error || err?.message || "unknown error")
      );
      setDeleting(false);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="px-3 py-1.5 text-sm text-red-600 border border-red-200 dark:border-red-900 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
      >
        🗑 Delete Product
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-lg">
      <span className="text-sm text-red-700 dark:text-red-300">
        Delete <strong>{productName || mpn}</strong>? This cannot be undone.
      </span>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
      >
        {deleting ? "Deleting…" : "Yes, Delete"}
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="px-3 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        Cancel
      </button>
    </div>
  );
}
