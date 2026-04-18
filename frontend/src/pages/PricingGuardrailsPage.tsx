import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function PricingGuardrailsPage() {
  const { role } = useAuth();
  if (role !== "admin" && role !== "owner") return <Navigate to="/dashboard" replace />;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link to="/admin" className="hover:text-blue-600">Admin</Link>
        <span>›</span>
        <span>Pricing Guardrails</span>
      </div>
      <h1 className="text-2xl font-bold mb-4">Pricing Guardrails</h1>
      <div className="bg-white dark:bg-gray-800 border rounded-lg p-6 text-center text-gray-400">
        <p className="text-lg">Coming soon</p>
        <p className="text-sm mt-1">Price validation rules and margin thresholds will be configured here.</p>
      </div>
    </div>
  );
}
