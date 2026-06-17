import postgres from "postgres";

let sqlClient;
let schemaReady;

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

function sql() {
  if (!hasDatabase()) return null;
  if (!sqlClient) {
    sqlClient = postgres(process.env.DATABASE_URL, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: process.env.DATABASE_URL.includes("localhost") ? false : "require"
    });
  }
  return sqlClient;
}

async function ensureSchema() {
  const db = sql();
  if (!db) return false;
  if (!schemaReady) {
    schemaReady = db`
      create table if not exists receipt_calls (
        id text primary key,
        source_url text not null,
        symbol text not null,
        person_id text,
        called_at date,
        status text not null,
        call_data jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `.then(async () => {
      await db`create index if not exists receipt_calls_source_url_idx on receipt_calls (source_url)`;
      await db`create index if not exists receipt_calls_symbol_idx on receipt_calls (symbol)`;
      await db`create index if not exists receipt_calls_called_at_idx on receipt_calls (called_at desc)`;
      await db`
        create table if not exists receipt_candidates (
          source_url text primary key,
          query text,
          candidate_data jsonb not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;
      return true;
    });
  }
  return schemaReady;
}

function compactCall(call) {
  const {
    person,
    asset,
    returnPct,
    ...rest
  } = call;
  return rest;
}

export async function getStoredCalls() {
  if (!hasDatabase()) return [];
  try {
    const db = sql();
    await ensureSchema();
    const rows = await db`
      select call_data
      from receipt_calls
      order by called_at desc nulls last, updated_at desc
      limit 1000
    `;
    return rows.map((row) => row.call_data);
  } catch (error) {
    console.warn(`DB read skipped: ${error.message}`);
    return [];
  }
}

export async function saveLiveSearchResult({ query = "", candidates = [], calls = [] } = {}) {
  if (!hasDatabase()) return { savedCalls: 0, savedCandidates: 0 };
  try {
    const db = sql();
    await ensureSchema();
    const scorableCalls = calls
      .filter((call) => call.status === "ai_detected")
      .map(compactCall);

    for (const candidate of candidates) {
      await db`
        insert into receipt_candidates (source_url, query, candidate_data)
        values (${candidate.sourceUrl}, ${query}, ${db.json(candidate)})
        on conflict (source_url) do update set
          query = excluded.query,
          candidate_data = excluded.candidate_data,
          updated_at = now()
      `;
    }

    for (const call of scorableCalls) {
      await db`
        insert into receipt_calls (id, source_url, symbol, person_id, called_at, status, call_data)
        values (
          ${call.id},
          ${call.sourceUrl},
          ${call.symbol},
          ${call.personId},
          ${call.calledAt || null},
          ${call.status},
          ${db.json(call)}
        )
        on conflict (id) do update set
          source_url = excluded.source_url,
          symbol = excluded.symbol,
          person_id = excluded.person_id,
          called_at = excluded.called_at,
          status = excluded.status,
          call_data = excluded.call_data,
          updated_at = now()
      `;
    }

    return { savedCalls: scorableCalls.length, savedCandidates: candidates.length };
  } catch (error) {
    console.warn(`DB write skipped: ${error.message}`);
    return { savedCalls: 0, savedCandidates: 0, error: error.message };
  }
}
