import postgres from "postgres";

let sqlClient;
let schemaReady;

export function hasDatabase() {
  return hasUpstash() || Boolean(process.env.DATABASE_URL);
}

function hasUpstash() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function upstashCommand(command) {
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw new Error(`Upstash ${command?.[0] || "command"} failed: ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error);
  return payload.result;
}

async function upstashPipeline(commands) {
  if (!commands.length) return [];
  const response = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(commands)
  });
  if (!response.ok) throw new Error(`Upstash pipeline failed: ${response.status}`);
  const payload = await response.json();
  const errors = payload.filter((item) => item?.error);
  if (errors.length) throw new Error(errors[0].error);
  return payload.map((item) => item.result);
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
  if (hasUpstash()) {
    try {
      const ids = await upstashCommand(["ZREVRANGE", "receipt:calls:index", 0, 999]);
      if (!Array.isArray(ids) || !ids.length) return [];
      const keys = ids.map((id) => `receipt:call:${id}`);
      const values = await upstashCommand(["MGET", ...keys]);
      return values
        .filter(Boolean)
        .map((value) => JSON.parse(value));
    } catch (error) {
      console.warn(`Upstash read skipped: ${error.message}`);
      return [];
    }
  }

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
  if (hasUpstash()) {
    try {
      const now = Date.now();
      const scorableCalls = calls
        .filter((call) => ["ai_detected", "seed_verified", "seed_candidate", "candidate", "neutral_reference"].includes(call.status))
        .map(compactCall);
      const commands = [];

      for (const candidate of candidates) {
        if (!candidate.sourceUrl) continue;
        commands.push(["SET", `receipt:candidate:${candidate.sourceUrl}`, JSON.stringify({ ...candidate, query })]);
        commands.push(["ZADD", "receipt:candidates:index", now, candidate.sourceUrl]);
      }

      for (const call of scorableCalls) {
        commands.push(["SET", `receipt:call:${call.id}`, JSON.stringify(call)]);
        commands.push(["ZADD", "receipt:calls:index", new Date(call.calledAt || now).getTime(), call.id]);
      }

      await upstashPipeline(commands);
      return { savedCalls: scorableCalls.length, savedCandidates: candidates.length };
    } catch (error) {
      console.warn(`Upstash write skipped: ${error.message}`);
      return { savedCalls: 0, savedCandidates: 0, error: error.message };
    }
  }

  if (!hasDatabase()) return { savedCalls: 0, savedCandidates: 0 };
  try {
    const db = sql();
    await ensureSchema();
    const scorableCalls = calls
      .filter((call) => ["ai_detected", "seed_verified", "seed_candidate", "candidate", "neutral_reference"].includes(call.status))
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
