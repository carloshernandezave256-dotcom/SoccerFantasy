update public.players
set api_football_id=548685,
    position='MID',
    active=true,
    draft_rank=coalesce(draft_rank,(select coalesce(max(draft_rank),0)+1 from public.players where active))
where full_name='Alexis Ciria' and club='Real Madrid';

update public.players
set provider_id='api-football:274254',
    api_football_id=274254,
    position='MID',
    active=true
where full_name='Lucas Bretelle' and club='Le Mans';

with payload(api_football_id,full_name,position,club,competition,ordinal) as (values
  (478201::bigint,'Adam Zulevic','FWD'::public.player_position,'Genoa','Serie A',1),
  (348532,'Costantino Favasuli','DEF'::public.player_position,'Napoli','Serie A',2),
  (338201,'Hugo Picard','MID'::public.player_position,'Estac Troyes','Ligue 1',3),
  (21451,'Renaud Ripart','FWD'::public.player_position,'Estac Troyes','Ligue 1',4),
  (673793,'Idrissa Soukouna','MID'::public.player_position,'Estac Troyes','Ligue 1',5),
  (670620,'Yacouba Kone','FWD'::public.player_position,'Estac Troyes','Ligue 1',6),
  (290215,'Raúl Torrente','DEF'::public.player_position,'Le Mans','Ligue 1',7),
  (158587,'Romain Cagnon','GK'::public.player_position,'Stade Brestois 29','Ligue 1',8),
  (629781,'Mathis Lainé','MID'::public.player_position,'Stade Brestois 29','Ligue 1',9),
  (668717,'Xavier Mandza','DEF'::public.player_position,'Nice','Ligue 1',10),
  (670540,'Aboulaye Camara','MID'::public.player_position,'Nice','Ligue 1',11),
  (386277,'Thomas Jørgensen','MID'::public.player_position,'Toulouse','Ligue 1',12),
  (472572,'Thomas de Martis','FWD'::public.player_position,'Parma','Serie A',13),
  (432610,'Ousmane Diallo','FWD'::public.player_position,'Parma','Serie A',14)
), bounds as (
  select coalesce(max(draft_rank),0) max_rank from public.players
)
insert into public.players(provider_id,full_name,position,club,competition,active,draft_rank,api_football_id)
select 'api-football:'||p.api_football_id,
       p.full_name,p.position,p.club,p.competition,true,b.max_rank+p.ordinal,p.api_football_id
from payload p cross join bounds b
on conflict(provider_id) do update
set full_name=excluded.full_name,
    position=excluded.position,
    club=excluded.club,
    competition=excluded.competition,
    active=true,
    api_football_id=excluded.api_football_id;
