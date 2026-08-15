alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists theme_preference text not null default 'system',
  add column if not exists notifications_enabled boolean not null default true;

alter table public.profiles drop constraint if exists profiles_theme_preference_check;
alter table public.profiles add constraint profiles_theme_preference_check check (theme_preference in ('system','light','dark'));

create or replace function public.my_profile()
returns table(display_name text,avatar_url text,theme_preference text,notifications_enabled boolean)
language plpgsql security definer set search_path='' as $$
begin
  return query select p.display_name,p.avatar_url,p.theme_preference,p.notifications_enabled from public.profiles p where p.id=(select auth.uid());
end$$;

create or replace function public.update_my_profile(p_display_name text,p_avatar_url text,p_theme_preference text,p_notifications_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(trim(p_display_name))<2 or char_length(trim(p_display_name))>40 then raise exception 'Display name must be 2 to 40 characters'; end if;
  if p_theme_preference not in ('system','light','dark') then raise exception 'Choose a valid appearance'; end if;
  update public.profiles set display_name=trim(p_display_name),avatar_url=nullif(trim(coalesce(p_avatar_url,'')),''),theme_preference=p_theme_preference,notifications_enabled=p_notifications_enabled where id=(select auth.uid());
  update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('display_name',trim(p_display_name)) where id=(select auth.uid());
end$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('avatars','avatars',false,3145728,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=3145728,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists "Users read own avatar" on storage.objects;
create policy "Users read own avatar" on storage.objects for select to authenticated using(bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "Users upload own avatar" on storage.objects;
create policy "Users upload own avatar" on storage.objects for insert to authenticated with check(bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "Users update own avatar" on storage.objects;
create policy "Users update own avatar" on storage.objects for update to authenticated using(bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);

revoke all on function public.my_profile() from public,anon;
revoke all on function public.update_my_profile(text,text,text,boolean) from public,anon;
grant execute on function public.my_profile() to authenticated;
grant execute on function public.update_my_profile(text,text,text,boolean) to authenticated;
