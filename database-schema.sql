-- Scientific ESSENCE Editorial Portal
-- The profiles table and auth.users profile trigger were created separately.

-- Multi role support. The profiles.role column remains the primary role for
-- backward compatibility. Additional permissions are stored independently.
create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('author','reviewer','editor','admin')),
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table public.user_roles enable row level security;
grant select on public.user_roles to authenticated;

create or replace function public.has_role(_user_id uuid, _role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = _user_id and ur.role = _role
  )
  or exists (
    select 1 from public.profiles p
    where p.id = _user_id and p.role = _role
  );
$;

-- This script documents the additional manuscript workflow schema already applied.

create table if not exists public.manuscripts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 5 and 300),
  abstract text not null check (char_length(abstract) between 50 and 10000),
  keywords text[] not null default '{}',
  status text not null default 'submitted' check (status in ('draft','submitted','under_review','revision_requested','accepted','rejected')),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reviewer_assignments (
  id uuid primary key default gen_random_uuid(),
  manuscript_id uuid not null references public.manuscripts(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  due_at timestamptz,
  unique (manuscript_id, reviewer_id)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  manuscript_id uuid not null references public.manuscripts(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  recommendation text not null check (recommendation in ('accept','minor_revision','major_revision','reject')),
  comments text not null check (char_length(comments) between 20 and 10000),
  submitted_at timestamptz not null default now(),
  unique (manuscript_id, reviewer_id)
);

alter table public.manuscripts enable row level security;
alter table public.reviewer_assignments enable row level security;
alter table public.reviews enable row level security;

grant select, insert, update on public.manuscripts to authenticated;
grant select, insert, update, delete on public.reviewer_assignments to authenticated;
grant select, insert, update on public.reviews to authenticated;

create policy "Authors insert own manuscripts" on public.manuscripts for insert to authenticated
with check (author_id = (select auth.uid()) and status in ('draft','submitted'));

create policy "Authors and assigned reviewers read manuscripts" on public.manuscripts for select to authenticated
using (
  author_id = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','editor'))
  or exists (select 1 from public.reviewer_assignments ra where ra.manuscript_id = manuscripts.id and ra.reviewer_id = (select auth.uid()))
);

create policy "Authors update own editable manuscripts" on public.manuscripts for update to authenticated
using (author_id = (select auth.uid()) and status in ('draft','revision_requested'))
with check (author_id = (select auth.uid()) and status in ('draft','revision_requested'));

create policy "Editors update manuscripts" on public.manuscripts for update to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','editor')))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','editor')));

create policy "Editors manage reviewer assignments" on public.reviewer_assignments for all to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','editor')))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','editor')));

create policy "Reviewers read own assignments" on public.reviewer_assignments for select to authenticated
using (reviewer_id = (select auth.uid()));

create policy "Reviewers read assigned manuscripts" on public.reviews for select to authenticated
using (reviewer_id = (select auth.uid()) or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','editor')));

create policy "Assigned reviewers submit reviews" on public.reviews for insert to authenticated
with check (reviewer_id = (select auth.uid()) and exists (select 1 from public.reviewer_assignments ra where ra.manuscript_id = reviews.manuscript_id and ra.reviewer_id = (select auth.uid())));

create policy "Reviewers update own reviews" on public.reviews for update to authenticated
using (reviewer_id = (select auth.uid()) and exists (select 1 from public.reviewer_assignments ra where ra.manuscript_id = reviews.manuscript_id and ra.reviewer_id = (select auth.uid())))
with check (reviewer_id = (select auth.uid()) and exists (select 1 from public.reviewer_assignments ra where ra.manuscript_id = reviews.manuscript_id and ra.reviewer_id = (select auth.uid())));
