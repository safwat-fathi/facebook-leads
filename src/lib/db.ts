import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// One connection per process (the job worker and the request handlers share it). WAL lets reads proceed while the worker writes.
const SCHEMA = `
create table if not exists pages (
  fb_page_id text primary key, url text, title text, categories text, category text, business_type text,
  followers integer not null default 0,
  country text, city text, district text, location_source text,
  phone text, email text, wa text, whatsapp text, whatsapp_source text, ad_running integer not null default 0,
  website_listed text, website_listed_class text,
  website_url text, website_domain text, website_status text, website_evidence text, website_checked_at text, agent_cost_usd real,
  stage text not null default 'new', notes text, verdict text,
  raw text, discovered_by text, first_seen text, last_seen text);
create table if not exists jobs (
  id integer primary key autoincrement,
  kind text not null,
  params text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  budget_usd real not null, spent_usd real not null default 0,
  progress text, log text not null default '', error text,
  apify_runs text not null default '[]', cancel_requested integer not null default 0,
  created_at text not null, started_at text, finished_at text);
create table if not exists signals (
  fb_page_id text primary key references pages(fb_page_id) on delete cascade, enriched_at text not null,
  posts_fetched integer not null default 0, posts_30d integer not null default 0, last_post_at text,
  inbox_posts integer not null default 0, cod_posts integer not null default 0, shop_link_posts integer not null default 0, price_posts integer not null default 0,
  comments_total integer not null default 0, post_phones text not null default '[]', quotes text not null default '[]',
  ads_checked integer not null default 0, ads_active integer not null default 0, ads_message_cta integer not null default 0, ads_first_start text,
  cost_usd real);
create table if not exists spend (
  id integer primary key autoincrement, job_id integer references jobs(id),
  provider text not null check (provider in ('apify', 'openrouter')), usd real not null, note text, at text not null);
create index if not exists spend_at on spend(at);
create index if not exists jobs_status on jobs(status);
`;
// Columns added after the first release of `pages`: bring older databases (like the one from probe/) up to date in place.
const LATE_COLUMNS: [string, string][] = [['category', 'text'], ['business_type', 'text'], ['whatsapp', 'text'], ['whatsapp_source', 'text'], ['stage', "text not null default 'new'"], ['notes', 'text'], ['verdict', 'text']];

// Early databases limited jobs.kind with a CHECK constraint, which SQLite cannot alter: rebuild the table (the documented procedure:
// foreign keys off, copy, drop, rename) so new job kinds are accepted. Rows and ids are preserved.
function relaxJobKind(db: DatabaseSync) {
  const sql = (db.prepare("select sql from sqlite_master where type = 'table' and name = 'jobs'").get() as { sql: string } | undefined)?.sql ?? '';
  if (!/check\s*\(\s*kind\s+in/i.test(sql)) return;
  db.exec('pragma foreign_keys = off; begin;');
  try {
    db.exec(sql.replace(/check\s*\(\s*kind\s+in\s*\([^)]*\)\s*\)/i, '').replace(/create table (if not exists )?"?jobs"?/i, 'create table jobs_new'));
    db.exec('insert into jobs_new select * from jobs; drop table jobs; alter table jobs_new rename to jobs; create index if not exists jobs_status on jobs(status); commit;');
  } catch (e) { db.exec('rollback'); throw e; } finally { db.exec('pragma foreign_keys = on'); }
}

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('pragma journal_mode = WAL; pragma busy_timeout = 5000; pragma foreign_keys = on;');
  relaxJobKind(db); // before SCHEMA: an old jobs table must be rebuilt first
  db.exec(SCHEMA);
  const have = new Set((db.prepare('pragma table_info(pages)').all() as { name: string }[]).map((c) => c.name));
  for (const [col, def] of LATE_COLUMNS) if (!have.has(col)) db.exec(`alter table pages add column ${col} ${def}`);
  return db;
}

const g = globalThis as unknown as { __fblDb?: DatabaseSync };
export function getDb(): DatabaseSync {
  if (g.__fblDb) return g.__fblDb;
  const dir = process.env.DATA_DIR ?? './data';
  return (g.__fblDb = openDb(process.env.DB_PATH ?? `${dir}/leads.db`));
}
// Tests point the app at a fresh in-memory database.
export function useDbForTests(db: DatabaseSync | null) { g.__fblDb = db ?? undefined; }
