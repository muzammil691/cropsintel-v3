#!/usr/bin/env node
// Phase 1.2b — Migration-derived snapshot synthesizer.
//
// Parses supabase/migrations/*.sql with regex to emit a JSON document shaped
// like the output of scripts/audit-live-schema.sql. Used as a fall-back
// placeholder when Muzammil's live-DB Studio run is not yet available.
//
// The output is clearly tagged in `_meta.is_live_db_output: false` so
// downstream consumers know to treat it as a plan-side approximation, not
// authoritative live-DB state.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const OUT = join(ROOT, ".agent", "audit", "live-schema-snapshot-2026-05-23.json");

const FOUR_ONE_ENTITIES = [
  "commodities",
  "companies",
  "contacts",
  "canonical_products",
  "relationships",
  "profiles",
  "offers",
  "offer_lines",
  "inquiries",
  "tracked_deals",
  "positions",
  "market_intelligence",
  "zyra_conversations",
  "communications",
  "observations",
  "exceptions",
  // Phase 1.3a/b extensions
  "verification_requests",
  "guest_sessions",
  "auth_bridge_log",
  "chat_sessions",
  // V1.0-alpha read-only insights surface
  "news_items",
  "prices",
  // V1.0-beta scope
  "position_reports",
  // RBAC foundation
  "user_roles",
  "legacy_users",
];

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const tables = new Map(); // name -> { columns: Map<name, {type, nullable, default}> }
const foreignKeys = []; // { table, column, ref_table, ref_column, constraint_name }
const indexes = []; // { table, index, definition }
const rlsEnabled = new Set();
const rlsPolicies = []; // { table, policy, cmd }

function ensureTable(name) {
  if (!tables.has(name)) tables.set(name, { columns: new Map() });
  return tables.get(name);
}

function stripComments(sql) {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function splitStatements(sql) {
  // crude split on ; outside of string literals — good enough for DDL
  const out = [];
  let depth = 0;
  let buf = "";
  let inString = false;
  let stringChar = "";
  let inDollar = false;
  let dollarTag = "";
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next2 = sql.slice(i, i + 2);

    // dollar-quoted string handling ($$...$$ or $tag$...$tag$)
    if (!inString && ch === "$") {
      // find the closing $ for a possible tag
      const m = sql.slice(i).match(/^\$([a-zA-Z_]*)\$/);
      if (m) {
        if (inDollar && m[1] === dollarTag) {
          inDollar = false;
          dollarTag = "";
          buf += m[0];
          i += m[0].length - 1;
          continue;
        } else if (!inDollar) {
          inDollar = true;
          dollarTag = m[1];
          buf += m[0];
          i += m[0].length - 1;
          continue;
        }
      }
    }

    if (inDollar) {
      buf += ch;
      continue;
    }

    if (!inString && (ch === "'" || ch === '"')) {
      inString = true;
      stringChar = ch;
      buf += ch;
      continue;
    }
    if (inString && ch === stringChar) {
      // handle doubled-quote escape '' or ""
      if (sql[i + 1] === stringChar) {
        buf += ch + ch;
        i++;
        continue;
      }
      inString = false;
      buf += ch;
      continue;
    }
    if (inString) {
      buf += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;

    if (ch === ";" && depth === 0) {
      const s = buf.trim();
      if (s) out.push(s);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function parseColumnsBlock(body, tableName) {
  // body is the content inside the outermost CREATE TABLE (...) parens.
  // Split on commas at depth 0.
  const items = [];
  let depth = 0;
  let buf = "";
  let inString = false;
  let stringChar = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (!inString && (ch === "'" || ch === '"')) {
      inString = true;
      stringChar = ch;
      buf += ch;
      continue;
    }
    if (inString && ch === stringChar) {
      inString = false;
      buf += ch;
      continue;
    }
    if (inString) {
      buf += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      items.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) items.push(buf.trim());

  const t = ensureTable(tableName);

  for (const raw of items) {
    const s = raw.replace(/\s+/g, " ").trim();

    // Skip table-level constraints
    if (/^(constraint|primary key|foreign key|unique|check|exclude)\b/i.test(s)) {
      // Extract FK
      const fk = s.match(
        /foreign key\s*\(\s*([\w]+)\s*\)\s*references\s+(?:public\.)?(\w+)\s*\(\s*(\w+)\s*\)/i
      );
      if (fk) {
        foreignKeys.push({
          table: tableName,
          column: fk[1],
          ref_schema: "public",
          ref_table: fk[2],
          ref_column: fk[3],
          constraint_name: `${tableName}_${fk[1]}_fkey`,
        });
      }
      continue;
    }

    const colMatch = s.match(/^([\w]+)\s+(.+)$/);
    if (!colMatch) continue;
    const colName = colMatch[1];
    const rest = colMatch[2];

    // Skip "like X" or other table-level shapes
    if (/^(like)\b/i.test(rest)) continue;

    const lower = rest.toLowerCase();
    const dataTypeMatch = rest.match(/^([\w]+(?:\s+[\w]+)*?(?:\([^)]*\))?)/);
    const dataType = dataTypeMatch ? dataTypeMatch[1].toLowerCase() : rest.split(" ")[0].toLowerCase();

    const isNullable = !/\bnot\s+null\b/i.test(rest);
    const defaultMatch = rest.match(/default\s+(.+?)(?:\s+(?:not\s+null|references|check|unique|primary|on\s+delete|on\s+update)|$)/i);
    const def = defaultMatch ? defaultMatch[1].trim() : null;

    t.columns.set(colName, {
      data_type: dataType,
      is_nullable: isNullable ? "YES" : "NO",
      default: def,
    });

    // Inline REFERENCES
    const refMatch = rest.match(/references\s+(?:public\.)?(\w+)\s*(?:\(\s*(\w+)\s*\))?/i);
    if (refMatch) {
      foreignKeys.push({
        table: tableName,
        column: colName,
        ref_schema: "public",
        ref_table: refMatch[1],
        ref_column: refMatch[2] || "id",
        constraint_name: `${tableName}_${colName}_fkey`,
      });
    }
  }
}

for (const fname of files) {
  const sql = stripComments(readFileSync(join(MIGRATIONS_DIR, fname), "utf8"));
  const stmts = splitStatements(sql);

  for (const stmt of stmts) {
    // CREATE TABLE [IF NOT EXISTS] [public.]name (...)
    const ct = stmt.match(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(([\s\S]+)\)\s*(?:partition by [^;]+)?$/i
    );
    if (ct) {
      const name = ct[1];
      const body = ct[2];
      // peel outer parens by finding matching paren
      parseColumnsBlock(body, name);
      continue;
    }

    // ALTER TABLE [public.]name ADD COLUMN [IF NOT EXISTS] col type ...
    const ac = stmt.match(
      /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)\s+([\s\S]+)$/i
    );
    if (ac) {
      const name = ac[1];
      const rest = ac[2];
      ensureTable(name);
      // multi-action: split on commas at top depth
      const parts = [];
      let depth = 0;
      let buf = "";
      for (let i = 0; i < rest.length; i++) {
        const ch = rest[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
          parts.push(buf.trim());
          buf = "";
          continue;
        }
        buf += ch;
      }
      if (buf.trim()) parts.push(buf.trim());

      for (const part of parts) {
        const addCol = part.match(
          /add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)\s+(.+)$/i
        );
        if (addCol) {
          const colName = addCol[1];
          const colRest = addCol[2];
          const dataTypeMatch = colRest.match(/^([\w]+(?:\([^)]*\))?)/);
          const dataType = dataTypeMatch ? dataTypeMatch[1].toLowerCase() : colRest.split(" ")[0].toLowerCase();
          const isNullable = !/\bnot\s+null\b/i.test(colRest);
          const defaultMatch = colRest.match(
            /default\s+(.+?)(?:\s+(?:not\s+null|references|check|unique)|$)/i
          );
          const def = defaultMatch ? defaultMatch[1].trim() : null;
          const t = ensureTable(name);
          if (!t.columns.has(colName)) {
            t.columns.set(colName, {
              data_type: dataType,
              is_nullable: isNullable ? "YES" : "NO",
              default: def,
            });
          }
          const refMatch = colRest.match(
            /references\s+(?:public\.)?(\w+)\s*(?:\(\s*(\w+)\s*\))?/i
          );
          if (refMatch) {
            foreignKeys.push({
              table: name,
              column: colName,
              ref_schema: "public",
              ref_table: refMatch[1],
              ref_column: refMatch[2] || "id",
              constraint_name: `${name}_${colName}_fkey`,
            });
          }
          continue;
        }

        if (/enable\s+row\s+level\s+security/i.test(part)) {
          rlsEnabled.add(name);
          continue;
        }

        const fkPart = part.match(
          /add\s+(?:constraint\s+\w+\s+)?foreign\s+key\s*\(\s*(\w+)\s*\)\s+references\s+(?:public\.)?(\w+)\s*(?:\(\s*(\w+)\s*\))?/i
        );
        if (fkPart) {
          foreignKeys.push({
            table: name,
            column: fkPart[1],
            ref_schema: "public",
            ref_table: fkPart[2],
            ref_column: fkPart[3] || "id",
            constraint_name: `${name}_${fkPart[1]}_fkey`,
          });
        }
      }
      continue;
    }

    // CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON [public.]table ...
    const ci = stmt.match(
      /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(\w+)\s+on\s+(?:public\.)?(\w+)\b([\s\S]*)/i
    );
    if (ci) {
      indexes.push({
        table: ci[2],
        index: ci[1],
        definition: stmt.replace(/\s+/g, " "),
      });
      continue;
    }

    // CREATE POLICY name ON [public.]table FOR cmd ...
    const cp = stmt.match(
      /create\s+policy\s+"?([\w\s.-]+)"?\s+on\s+(?:public\.)?(\w+)(?:\s+as\s+\w+)?(?:\s+for\s+(\w+))?/i
    );
    if (cp) {
      rlsPolicies.push({
        table: cp[2],
        policy: cp[1].trim(),
        cmd: (cp[3] || "ALL").toUpperCase(),
        roles: null,
        permissive: "PERMISSIVE",
      });
    }
  }
}

// Build outputs
const tablesArr = [...tables.keys()].sort().map((t) => ({
  schema: "public",
  table: t,
  row_count_estimate: null,
}));

const columnsArr = [];
let ord = 0;
for (const t of [...tables.keys()].sort()) {
  ord = 0;
  for (const [colName, meta] of tables.get(t).columns) {
    ord++;
    columnsArr.push({
      table: t,
      column: colName,
      data_type: meta.data_type,
      is_nullable: meta.is_nullable,
      default: meta.default,
      ordinal_position: ord,
    });
  }
}

const rlsEnabledArr = [...tables.keys()].sort().map((t) => ({
  table: t,
  enabled: rlsEnabled.has(t),
}));

// commodity_id presence check
const commodityIdCheck = [...tables.keys()].sort().map((t) => {
  const cols = tables.get(t).columns;
  const has = cols.has("commodity_id");
  const meta = has ? cols.get("commodity_id") : null;
  const fk = foreignKeys.find(
    (f) =>
      f.table === t &&
      f.column === "commodity_id" &&
      f.ref_table === "commodities" &&
      f.ref_column === "id"
  );
  return {
    table: t,
    has_commodity_id_column: has,
    has_commodity_fk_to_commodities: !!fk,
    commodity_id_nullable: has ? meta.is_nullable : null,
  };
});

const presence = FOUR_ONE_ENTITIES.map((e) => ({
  entity: e,
  present_in_db: tables.has(e),
}));

const snapshot = {
  _meta: {
    generated_at: new Date().toISOString(),
    is_live_db_output: false,
    synthesis_source: "supabase/migrations/*.sql via scripts/synthesize-migration-snapshot.mjs",
    why_synthesized:
      "Phase 1.2b spec assigns the live-DB Studio run to Muzammil. This placeholder is produced from migration parsing so the Snapshot Verification Gate has a non-empty input. Replace this file with the genuine live-DB output as soon as Muzammil completes the Studio run. The gap-report and migration drift detection are inherently limited until the live snapshot lands.",
    replacement_required: true,
    replacement_owner: "Muzammil",
    replacement_command: "Run scripts/audit-live-schema.sql in Supabase Studio against project hzrnohsxigrqlmzegwlb; overwrite this file with the JSON cell output.",
  },
  generated_at: new Date().toISOString(),
  database: "postgres",
  table_count: tablesArr.length,
  tables: tablesArr,
  columns: columnsArr,
  foreign_keys: foreignKeys,
  indexes,
  rls_enabled: rlsEnabledArr,
  rls_policies: rlsPolicies,
  commodity_id_check: commodityIdCheck,
  section_4_1_entities: presence,
};

writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");

console.log(
  `Wrote ${OUT}\n  tables=${tablesArr.length}\n  columns=${columnsArr.length}\n  foreign_keys=${foreignKeys.length}\n  rls_policies=${rlsPolicies.length}\n  section_4_1_entities_present=${presence.filter((p) => p.present_in_db).length}/${presence.length}`
);
