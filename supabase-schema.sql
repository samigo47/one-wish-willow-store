create table if not exists public.orders (
  order_number text primary key,
  status text not null default 'pending',
  received_at timestamptz default now(),
  updated_at timestamptz default now(),
  data jsonb not null
);

create index if not exists orders_received_at_idx
  on public.orders (received_at desc);

create index if not exists orders_status_idx
  on public.orders (status);
