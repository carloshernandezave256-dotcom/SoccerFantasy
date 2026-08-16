update public.players legacy
set full_name=api.full_name,position=api.position,club=api.club,competition=api.competition,
  photo_url=api.photo_url,nationality=api.nationality,active=true
from public.players api
where legacy.id=148 and api.api_football_id=18889;
