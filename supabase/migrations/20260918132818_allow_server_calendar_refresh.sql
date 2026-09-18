-- The public invoker wrapper already permits service_role. Grant only the
-- missing underlying calendar helper access to that same trusted server role.
grant usage on schema private to service_role;
grant execute on function private.refresh_league_calendar(uuid) to service_role;
