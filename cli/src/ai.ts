import Anthropic from "@anthropic-ai/sdk";

// The model specified by the task
const MODEL = "claude-sonnet-4-20250514";

// System prompt template — schema is interpolated at call time
function buildSystemPrompt(schema: string): string {
  return `You are a SQL expert for a SQLite database. Your job is to translate natural language questions into valid, read-only SELECT statements.

## Database Schema

${schema}

## Rules

1. Generate a single SELECT statement only — no INSERT, UPDATE, DELETE, DROP, CREATE, or any other mutations.
2. Use SQLite syntax (e.g., strftime for dates, CAST for type conversion).
3. Use LIKE with % wildcards for fuzzy text matching (e.g., WHERE name LIKE '%Saturn%').
4. Default to a reasonable LIMIT (e.g., LIMIT 100) if the query could return many rows.
5. If the question is ambiguous, make reasonable assumptions and note them in the explanation.

## Response Format

Respond with ONLY a JSON object — no markdown fences, no extra text — in this exact shape:
{
  "sql": "<the SELECT statement>",
  "explanation": "<one sentence describing what the query does, including any assumptions made>"
}`;
}

/**
 * Translates a natural language question into a SQL SELECT statement
 * using the Anthropic API.
 *
 * @param question - The natural language question to translate
 * @param schema   - The database schema as a human-readable string
 * @returns        - An object with the generated SQL and a one-sentence explanation
 */
export async function naturalLanguageToSql(
  question: string,
  schema: string
): Promise<{ sql: string; explanation: string }> {
  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(schema),
      messages: [{ role: "user", content: question }],
    });

    // Extract the text content from the response
    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Anthropic API returned no text content in the response");
    }

    const rawText = textBlock.text.trim();

    // Parse the JSON response
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error(
        `Failed to parse Anthropic API response as JSON. Raw response: ${rawText.slice(0, 200)}`
      );
    }

    // Validate the expected shape
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>)["sql"] !== "string" ||
      typeof (parsed as Record<string, unknown>)["explanation"] !== "string"
    ) {
      throw new Error(
        `Anthropic API response JSON is missing required "sql" or "explanation" fields. Got: ${rawText.slice(0, 200)}`
      );
    }

    const result = parsed as { sql: string; explanation: string };
    return { sql: result.sql, explanation: result.explanation };
  } catch (err) {
    // Re-throw as a clear Error if it isn't one already (e.g., SDK throws non-Error)
    if (err instanceof Error) {
      throw new Error(`naturalLanguageToSql failed: ${err.message}`);
    }
    throw new Error(`naturalLanguageToSql failed: ${String(err)}`);
  }
}

/**
 * Checks whether ANTHROPIC_API_KEY is set in the environment.
 * Prints a helpful error message to stderr if it is missing.
 *
 * @returns true if the key is present and non-empty, false otherwise
 */
export function validateApiKey(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.trim() === "") {
    console.error(
      "Error: ANTHROPIC_API_KEY is not set.\n" +
        "Please export your Anthropic API key before running:\n" +
        "  export ANTHROPIC_API_KEY=sk-ant-..."
    );
    return false;
  }
  return true;
}
