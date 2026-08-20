-- Auction leagues use blind contract offers exclusively. There is no
-- first-come free-agency period after offers are processed.
revoke all on function public.sign_available_player(uuid,bigint,bigint)
from public,anon,authenticated;

drop function public.sign_available_player(uuid,bigint,bigint);

