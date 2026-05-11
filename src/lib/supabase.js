/*
 * Supabase table — run once in the Supabase SQL editor:
 *
 * create table slips (
 *   id          uuid primary key default gen_random_uuid(),
 *   created_at  timestamptz default now(),
 *   slip_type   text,
 *   players     jsonb,
 *   legs        integer,
 *   goblin_count integer default 0,
 *   result      text default 'Pending',
 *   bet_amount  numeric default 0,
 *   payout      numeric default 0,
 *   league      text,
 *   ev          numeric,
 *   joint_prob  numeric
 * );
 * alter table slips enable row level security;
 * create policy "public access" on slips for all using (true) with check (true);
 *
 * Migration — run once to enable missed-leg tracking:
 * alter table slips add column if not exists missed_leg text;
 *
 * Ladder Challenge table — run once:
 * create table ladder (
 *   id           uuid primary key default gen_random_uuid(),
 *   created_at   timestamptz default now(),
 *   streak       integer default 0,
 *   bankroll     numeric default 10,
 *   result       text default 'Pending',
 *   slip_picks   jsonb,
 *   entry_amount numeric default 10
 * );
 * alter table ladder enable row level security;
 * create policy "public access" on ladder for all using (true) with check (true);
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://twnltzdurccawpwgucrg.supabase.co'
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_1FDBKnniLaXzGMVilnNwAA_IvGN302E'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
