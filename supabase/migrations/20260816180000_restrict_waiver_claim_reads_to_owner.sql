drop policy if exists "managers read own waiver claims" on public.waiver_claims;
create policy "managers read own waiver claims"
on public.waiver_claims
for select
to authenticated
using ((select auth.uid()) = user_id);
