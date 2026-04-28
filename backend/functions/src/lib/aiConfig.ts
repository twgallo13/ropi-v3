/**
 * AI Plane Config Helper — TALLY-SETTINGS-UX Phase 3 / A.1
 *
 * Single source of truth for resolving the active AI provider + model
 * for a given workflow. Reads from:
 *   - ai_workflow_routing/{workflow_key}
 *   - ai_provider_registry/{provider_key} (and its embedded models[])
 *
 * Falls back to SEEDED_DEFAULT (anthropic / claude-opus-4-7 /
 * ANTHROPIC_API_KEY) on any miss-path, with a console.warn for
 * observability. Never throws on lookup failure — only AnthropicAdapter
 * throws when the resolved env var is empty (defensive).
 */
import admin from "firebase-admin";

const db = () => admin.firestore();

// ── Defaults (SEEDED_DEFAULT) ──────────────────────────────────────────
export const DEFAULT_PROVIDER_KEY = "anthropic";
export const DEFAULT_MODEL_KEY = "claude-opus-4-7";
export const DEFAULT_API_KEY_ENV_VAR = "ANTHROPIC_API_KEY";

// ── Adapter contract ───────────────────────────────────────────────────
export interface AIProviderAdapter {
  complete(
    userMessage: string,
    systemPrompt?: string,
    imageData?: string
  ): Promise<string>;
}

// ── Adapters ───────────────────────────────────────────────────────────
class AnthropicAdapter implements AIProviderAdapter {
  constructor(
    private model_key: string,
    private api_key_env_var_name: string
  ) {}

  async complete(
    userMessage: string,
    systemPrompt?: string,
    imageData?: string
  ): Promise<string> {
    const apiKey = process.env[this.api_key_env_var_name];
    if (!apiKey) {
      throw new Error(
        `AnthropicAdapter: env var '${this.api_key_env_var_name}' is not set`
      );
    }

    const messages: any[] = [];
    if (imageData) {
      messages.push({
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: imageData,
            },
          },
          { type: "text", text: userMessage },
        ],
      });
    } else {
      messages.push({ role: "user", content: userMessage });
    }

    const body: any = {
      model: this.model_key,
      max_tokens: 4096,
      messages,
    };
    if (systemPrompt) body.system = systemPrompt;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data: any = await res.json();
    if (!res.ok) {
      throw new Error(
        `Anthropic API error: ${res.status} — ${JSON.stringify(data)}`
      );
    }
    return data.content[0].text;
  }
}

class OpenAIAdapter implements AIProviderAdapter {
  constructor(
    private model_key: string,
    private api_key_env_var_name: string
  ) {}
  async complete(): Promise<string> {
    void this.model_key;
    void this.api_key_env_var_name;
    throw new Error("OpenAI adapter not yet configured");
  }
}

class GeminiAdapter implements AIProviderAdapter {
  constructor(
    private model_key: string,
    private api_key_env_var_name: string
  ) {}
  async complete(): Promise<string> {
    void this.model_key;
    void this.api_key_env_var_name;
    throw new Error("Gemini adapter not yet configured");
  }
}

// ── Adapter factory ────────────────────────────────────────────────────
export async function resolveAdapter(
  provider_key: string,
  model_key: string,
  api_key_env_var_name: string
): Promise<AIProviderAdapter> {
  switch (provider_key) {
    case "anthropic":
      return new AnthropicAdapter(model_key, api_key_env_var_name);
    case "openai":
      return new OpenAIAdapter(model_key, api_key_env_var_name);
    case "google":
      return new GeminiAdapter(model_key, api_key_env_var_name);
    default:
      console.warn(
        `[aiConfig] resolveAdapter: unknown provider_key='${provider_key}', falling back to anthropic`
      );
      return new AnthropicAdapter(model_key, api_key_env_var_name);
  }
}

// ── Workflow → resolved config ─────────────────────────────────────────
export interface ResolvedAiConfig {
  provider_key: string;
  model_key: string;
  api_key_env_var_name: string;
  resolved_from_default: boolean;
}

const SEEDED_DEFAULT: ResolvedAiConfig = {
  provider_key: DEFAULT_PROVIDER_KEY,
  model_key: DEFAULT_MODEL_KEY,
  api_key_env_var_name: DEFAULT_API_KEY_ENV_VAR,
  resolved_from_default: true,
};

export async function getAiConfigForWorkflow(
  workflow_key: string
): Promise<ResolvedAiConfig> {
  // Step 1: routing doc
  const routingSnap = await db()
    .collection("ai_workflow_routing")
    .doc(workflow_key)
    .get();
  if (!routingSnap.exists) {
    console.warn(
      `[aiConfig] workflow '${workflow_key}': routing doc missing → SEEDED_DEFAULT`
    );
    return { ...SEEDED_DEFAULT };
  }
  const routing: any = routingSnap.data() || {};

  // Step 1b: is_active
  if (routing.is_active === false) {
    console.warn(
      `[aiConfig] workflow '${workflow_key}': is_active=false → SEEDED_DEFAULT`
    );
    return { ...SEEDED_DEFAULT };
  }

  const providerKey: string | undefined = routing.provider_key;
  const modelKey: string | undefined = routing.model_key;
  if (!providerKey || !modelKey) {
    console.warn(
      `[aiConfig] workflow '${workflow_key}': provider_key/model_key missing → SEEDED_DEFAULT`
    );
    return { ...SEEDED_DEFAULT };
  }

  // Step 2: provider doc
  const providerSnap = await db()
    .collection("ai_provider_registry")
    .doc(providerKey)
    .get();
  if (!providerSnap.exists) {
    console.warn(
      `[aiConfig] workflow '${workflow_key}': provider '${providerKey}' missing → SEEDED_DEFAULT`
    );
    return { ...SEEDED_DEFAULT };
  }
  const provider: any = providerSnap.data() || {};
  if (provider.is_active === false) {
    console.warn(
      `[aiConfig] workflow '${workflow_key}': provider '${providerKey}' inactive → SEEDED_DEFAULT`
    );
    return { ...SEEDED_DEFAULT };
  }

  // Step 3: models[].find
  const models: any[] = Array.isArray(provider.models) ? provider.models : [];
  const model = models.find((m) => m && m.model_key === modelKey);
  if (!model) {
    console.warn(
      `[aiConfig] workflow '${workflow_key}': model '${modelKey}' not found in provider '${providerKey}'.models[] → SEEDED_DEFAULT`
    );
    return { ...SEEDED_DEFAULT };
  }

  // Step 4: model.is_active
  if (model.is_active === false) {
    console.warn(
      `[aiConfig] workflow '${workflow_key}': model '${modelKey}' inactive → SEEDED_DEFAULT`
    );
    return { ...SEEDED_DEFAULT };
  }

  const apiKeyEnvVar: string =
    provider.api_key_env_var_name || DEFAULT_API_KEY_ENV_VAR;

  return {
    provider_key: providerKey,
    model_key: modelKey,
    api_key_env_var_name: apiKeyEnvVar,
    resolved_from_default: false,
  };
}
