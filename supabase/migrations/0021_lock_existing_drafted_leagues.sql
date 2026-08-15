update public.leagues l
set joining_open=false
where joining_open=true
  and exists(select 1 from public.drafts d where d.league_id=l.id);
