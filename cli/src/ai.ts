// System prompt template — schema + domain context interpolated at call time
function buildSystemPrompt(schema: string, sampleValues: string): string {
  return `You are a SQL expert for a SQLite database containing data from NASA's Cassini mission to Saturn (1997–2017). Your job is to translate natural language questions into valid, read-only SELECT statements.

## Domain Context

This database contains the Cassini mission planning timeline. Key concepts:
- The **master_plan** table has one row per scheduled observation/activity. Each row is NOT a flyby — it's a single instrument observation.
- **Flybys** are named close encounters identified by the **request_name** column. For a given moon, flybys follow naming patterns like ENCEL4, ENCEL5, ..., ENCEL22 (for Enceladus), or TITAN, TITAN2, etc. To find flybys of a body, look for DISTINCT request_name values matching the body's prefix followed by a number (e.g., request_name GLOB 'ENCEL[0-9]*' for Enceladus flybys). Group by request_name to get one row per flyby with its date.
- The **target** column contains exact values (not free-text) — match them exactly, not with LIKE.
- The **date** column is in DD-Mon-YY format (e.g., "14-May-04"). For chronological ordering, use start_time_utc which is in ISO-like format (e.g., "2004-135T18:40:00").
- The **team** column is the instrument team (e.g., ISS = imaging, CIRS = infrared spectrometer, RADAR, etc.).
- The **planets** table has basic facts about Saturn's moons and planets in the Cassini context.

## Database Schema

${schema}

## Sample Column Values

${sampleValues}

## Rules

1. Generate a single SELECT statement only — no INSERT, UPDATE, DELETE, DROP, CREATE, or any other mutations.
2. Use SQLite syntax (e.g., strftime for dates, CAST for type conversion).
3. Match target values exactly as shown in the sample values (e.g., WHERE target = 'Enceladus', not LIKE '%Enceladus%').
4. Default to a reasonable LIMIT (e.g., LIMIT 100) if the query could return many rows.
5. If the question is ambiguous, make reasonable assumptions and note them in the explanation.
6. When asked about "flybys" or "encounters", find named flyby encounters via request_name (e.g., GLOB 'ENCEL[0-9]*'), NOT by counting distinct dates.
7. Order date results by start_time_utc for chronological order.

## Response Format

Respond with ONLY a JSON object — no markdown fences, no extra text — in this exact shape:
{
  "sql": "<the SELECT statement>",
  "explanation": "<one sentence describing what the query does, including any assumptions made>"
}`;
}

/**
 * Translates a natural language question into a SQL SELECT statement
 * by spawning `claude -p` as a subprocess.
 *
 * @param question    - The natural language question to translate
 * @param schema      - The database schema as a human-readable string
 * @param sampleValues - Sample values per column to improve query accuracy
 * @returns           - An object with the generated SQL and a one-sentence explanation
 */
export async function naturalLanguageToSql(
  question: string,
  schema: string,
  sampleValues: string = ""
): Promise<{ sql: string; explanation: string }> {
  const systemPrompt = buildSystemPrompt(schema, sampleValues);

  // Strip Claude Code env vars to avoid nested-session errors
  const env = { ...process.env };
  delete env["CLAUDECODE"];
  delete env["CLAUDE_CODE_SSE_PORT"];
  delete env["CLAUDE_CODE_ENTRYPOINT"];

  const proc = Bun.spawn(
    [
      "claude",
      "-p", question,
      "--system-prompt", systemPrompt,
      "--output-format", "text",
      "--model", "sonnet",
      "--dangerously-skip-permissions",
      "--allowedTools", "",  // no tools — pure reasoning only
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe", env }
  );

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(
      `naturalLanguageToSql failed: claude subprocess exited with code ${proc.exitCode}. stderr: ${stderr.trim()}`
    );
  }

  const rawText = stdout.trim();

  // Extract JSON object from response — robust against any surrounding text or fences
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `naturalLanguageToSql failed: could not parse claude response as JSON. Raw response: ${rawText.slice(0, 200)}`
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
      `naturalLanguageToSql failed: response JSON is missing required "sql" or "explanation" fields. Got: ${jsonStr.slice(0, 200)}`
    );
  }

  const result = parsed as { sql: string; explanation: string };
  return { sql: result.sql, explanation: result.explanation };
}

/**
 * Checks whether the `claude` CLI is available by running `claude --version`.
 * Returns true if the binary is found and exits 0, false otherwise.
 */
export async function validateClaude(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["claude", "--version"], {
      stdin: "ignore",
      stdout: "ignore",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    // spawn throws if the binary is not found
    return false;
  }
}
