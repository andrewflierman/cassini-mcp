import { handleAsk, handleQuery, handleTables, handleSchema } from "./commands.js";
import { startRepl } from "./repl.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type Subcommand = "ask" | "query" | "tables" | "schema" | "repl";
type OutputFormat = "table" | "json" | "csv";

interface ParsedArgs {
  subcommand: Subcommand;
  positionals: string[];   // args after the subcommand (the natural language question or SQL)
  db: string;
  limit: number;
  format: OutputFormat;
  help: boolean;
  showSql: boolean;
}

// ─── Usage ────────────────────────────────────────────────────────────────────

const USAGE = `
cassini — Query the Cassini mission database using natural language or SQL

Usage:
  cassini <question>                  Ask a natural language question (shorthand for 'ask')
  cassini ask <question>              Translate a question to SQL and run it
  cassini query <sql>                 Run a raw SQL query directly
  cassini tables                      List all tables with row counts
  cassini schema                      Print the full database schema
  cassini repl                        Start an interactive REPL session

Options:
  --db <path>                         Path to the SQLite database (default: ./cassini.db)
  --limit <n>                         Max rows to return (default: 50)
  --format <table|json|csv>           Output format (default: table)
  --sql                               Show the generated SQL without running it
  --help                              Print this help message

Examples:
  cassini what moons orbit Saturn?
  cassini ask "how many observations were made per year?"
  cassini query "SELECT * FROM observations LIMIT 5"
  cassini tables
  cassini schema
  cassini repl
`.trim();

// ─── Argument parser ──────────────────────────────────────────────────────────

const KNOWN_SUBCOMMANDS = new Set<Subcommand>(["ask", "query", "tables", "schema", "repl"]);

function parseArgs(argv: string[]): ParsedArgs {
  // argv starts after "bun" and "src/index.ts"
  const args = argv.slice(2);

  let subcommand: Subcommand | null = null;
  const positionals: string[] = [];
  let db = "./cassini.db";
  let limit = 50;
  let format: OutputFormat = "table";
  let help = false;
  let showSql = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      help = true;
      i++;
      continue;
    }

    if (arg === "--sql") {
      showSql = true;
      i++;
      continue;
    }

    if (arg === "--db") {
      if (i + 1 >= args.length) {
        console.error("Error: --db requires a path argument");
        process.exit(1);
      }
      db = args[++i];
      i++;
      continue;
    }

    if (arg === "--limit") {
      if (i + 1 >= args.length) {
        console.error("Error: --limit requires a number argument");
        process.exit(1);
      }
      const n = parseInt(args[++i], 10);
      if (isNaN(n) || n < 1) {
        console.error("Error: --limit must be a positive integer");
        process.exit(1);
      }
      limit = n;
      i++;
      continue;
    }

    if (arg === "--format") {
      if (i + 1 >= args.length) {
        console.error("Error: --format requires table|json|csv");
        process.exit(1);
      }
      const f = args[++i];
      if (f !== "table" && f !== "json" && f !== "csv") {
        console.error(`Error: --format must be one of: table, json, csv (got '${f}')`);
        process.exit(1);
      }
      format = f;
      i++;
      continue;
    }

    // First non-flag token: check if it's a known subcommand
    if (subcommand === null && KNOWN_SUBCOMMANDS.has(arg as Subcommand)) {
      subcommand = arg as Subcommand;
      i++;
      continue;
    }

    // Everything else goes into positionals
    positionals.push(arg);
    i++;
  }

  // Default: bare positionals with no subcommand → treat as 'ask'
  if (subcommand === null) {
    subcommand = "ask";
  }

  return { subcommand, positionals, db, limit, format, help, showSql };
}


// ─── Main entry point ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  // --help always wins
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }

  // No-op subcommands that need positionals (ask/query) with no args → show usage
  if (
    opts.subcommand === "ask" &&
    opts.positionals.length === 0
  ) {
    console.error(USAGE);
    process.exit(1);
  }

  if (
    opts.subcommand === "query" &&
    opts.positionals.length === 0
  ) {
    console.error(USAGE);
    process.exit(1);
  }

  // Dispatch
  switch (opts.subcommand) {
    case "ask":
      await handleAsk(opts);
      break;
    case "query":
      await handleQuery(opts);
      break;
    case "tables":
      await handleTables(opts);
      break;
    case "schema":
      await handleSchema(opts);
      break;
    case "repl":
      await startRepl({ db: opts.db, limit: opts.limit, format: opts.format });
      break;
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
