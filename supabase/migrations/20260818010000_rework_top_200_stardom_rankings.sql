begin;
alter table public.player_stardom_overrides drop constraint player_stardom_overrides_star_priority_check;
alter table public.player_stardom_overrides add constraint player_stardom_overrides_star_priority_check check(star_priority between 1 and 200);

delete from public.player_stardom_overrides;
with candidates(star_priority,short_name,long_name,fc_club,forced_id) as (values
(1,'K. Mbappé','Kylian Mbappé Lottin','Real Madrid',278),
(2,'M. Salah','Mohamed Salah Hamed Ghalyمحمد صلاح','Liverpool',306),
(3,'J. Bellingham','Jude Victor William Bellingham','Real Madrid',129718),
(4,'E. Haaland','Erling Braut Håland','Manchester City',null),
(5,'O. Dembélé','Masour Ousmane Dembélé','Paris Saint-Germain',null),
(6,'Rodri','Rodrigo Hernández Cascante','Manchester City',null),
(7,'V. van Dijk','Virgil van Dijk','Liverpool',null),
(8,'F. Wirtz','Florian Richard Wirtz','Liverpool',null),
(9,'Lamine Yamal','Lamine Yamal Nasraoui Ebanaلامين يامال نصراوي إبانا','FC Barcelona',null),
(10,'Vini Jr.','Vinicius José Paixão de Oliveira Junior','Real Madrid',762),
(11,'G. Donnarumma','Gianluigi Donnarumma','Manchester City',null),
(12,'H. Kane','Harry Edward Kane','FC Bayern München',null),
(13,'Alisson','Alisson Becker','Liverpool',null),
(14,'T. Courtois','Thibaut Courtois','Real Madrid',null),
(15,'Pedri','Pedro González López','FC Barcelona',null),
(16,'Vitinha','Vítor Machado Ferreira','Paris Saint-Germain',128384),
(17,'F. Valverde','Federico Santiago Valverde Dipetta','Real Madrid',null),
(18,'A. Hakimi','Achraf Hakimi Mouhأشرف حكيمي','Paris Saint-Germain',null),
(19,'Raphinha','Raphael Dias Belloli','FC Barcelona',null),
(20,'J. Kimmich','Joshua Walter Kimmich','FC Bayern München',null),
(21,'L. Martínez','Lautaro Javier Martínez','Inter',217),
(22,'R. Lewandowski','Robert Lewandowski','FC Barcelona',null),
(23,'J. Oblak','Jan Oblak','Atletico Madrid',null),
(24,'J. Musiala','Jamal Musiala','FC Bayern München',null),
(25,'A. Isak','Alexander Isak','Liverpool',null),
(26,'Gabriel','Gabriel dos Santos Magalhães','Arsenal',22224),
(27,'C. Palmer','Cole Jermaine Palmer','Chelsea',null),
(28,'J. Alvarez','Julián Álvarez','Atlético Madrid',null),
(29,'M. Ødegaard','Martin Ødegaard','Arsenal',null),
(30,'M. Caicedo','Moisés Isaac Caicedo Corozo','Chelsea',null),
(31,'V. Gyökeres','Viktor Einar Gyökeres','Arsenal',null),
(32,'A. Mac Allister','Alexis Mac Allister','Liverpool',null),
(33,'W. Saliba','William Alain André Gabriel Saliba','Arsenal',null),
(34,'A. Bastoni','Alessandro Bastoni','Inter',null),
(35,'J. Koundé','Jules Olivier Koundé','FC Barcelona',null),
(36,'D. Rice','Declan Rice','Arsenal',null),
(37,'S. Guirassy','Serhou Yadaly Guirassy','Borussia Dortmund',null),
(38,'F. de Jong','Frenkie de Jong','FC Barcelona',null),
(39,'N. Barella','Nicolò Barella','Inter',null),
(40,'Bruno Fernandes','Bruno Miguel Borges Fernandes','Manchester United',null),
(41,'J. Tah','Jonathan Glao Tah','FC Bayern München',null),
(42,'Marquinhos','Marcos Aoás Corrêa','Paris Saint-Germain',null),
(43,'M. Maignan','Mike Maignan','AC Milan',null),
(44,'David Raya','David Raya','Arsenal',null),
(45,'K. De Bruyne','Kevin De Bruyne','Napoli',null),
(46,'Y. Sommer','Yann Sommer','Inter',null),
(47,'K. Kvaratskhelia','Khvicha Kvaratskheliaხვიჩა კვარაცხელია','Paris Saint-Germain',null),
(48,'M. ter Stegen','Marc-André ter Stegen','Barcelona',null),
(49,'T. Reijnders','Tijjani Martinus Jan Reijnders Lekatompessy','Manchester City',null),
(50,'Bruno Guimarães','Bruno Guimarães Rodrigues Moura','Newcastle United',null),
(51,'T. Alexander-Arnold','Trent John Alexander-Arnold','Real Madrid',null),
(52,'I. Konaté','Ibrahima Konaté','Liverpool',null),
(53,'Rúben Dias','Rúben dos Santos Gato Alves Dias','Manchester City',null),
(54,'P. Dybala','Paulo Bruno Exequiel Dybala','Roma',null),
(55,'H. Çalhanoğlu','Hakan Çalhanoğlu','Inter',null),
(56,'A. Rüdiger','Antonio Rüdiger','Real Madrid',null),
(57,'Nico Williams','Nicholas Williams Arthuer','Athletic Club',null),
(58,'M. Olise','Michael Akpovie Olise','FC Bayern München',null),
(59,'Nuno Mendes','Nuno Alexandre Tavares Mendes','Paris Saint-Germain',null),
(60,'B. Saka','Bukayo Saka','Arsenal',null),
(61,'W. Pacho','Willian Joel Pacho Tenorio','Paris Saint-Germain',null),
(62,'S. Tonali','Sandro Tonali','Newcastle United',null),
(63,'G. Kobel','Gregor Kobel','Borussia Dortmund',null),
(64,'E. Martínez','Emiliano Martínez','Aston Villa',null),
(65,'De Gea','David de Gea','Fiorentina',null),
(66,'Rodrygo','Rodrygo Silva de Goes','Real Madrid',null),
(67,'Bremer','Gleison Bremer Silva Nascimento','Juventus',null),
(68,'Carvajal','Daniel Carvajal Ramos','Real Madrid',null),
(69,'A. Griezmann','Antoine Griezmann','Atlético Madrid',null),
(70,'D. Doué','Désiré Doué','Paris Saint-Germain',null),
(71,'João Neves','João Pedro Gonçalves Neves','Paris Saint-Germain',null),
(72,'P. Foden','Philip Walter Foden','Manchester City',null),
(73,'R. Gravenberch','Ryan Jiro Gravenberch','Liverpool',null),
(74,'B. Mbeumo','Bryan Tetsadong Marceau Mbeumo','Manchester United',null),
(75,'N. Schlotterbeck','Nico Cedric Schlotterbeck','Borussia Dortmund',null),
(76,'D. Upamecano','Dayotchanculle Oswald Upamecano','FC Bayern München',null),
(77,'Dani Olmo','Daniel Olmo Carvajal','FC Barcelona',null),
(78,'M. Thuram','Marcus Lilian Thuram-Ulien','Inter',null),
(79,'L. Díaz','Luis Fernando Díaz Marulanda','FC Bayern München',null),
(80,'S. McTominay','Scott Francis McTominay','Napoli',null),
(81,'Y. Tielemans','Youri Tielemans','Aston Villa',null),
(82,'P. Schick','Patrik Schick','Bayer 04 Leverkusen',null),
(83,'Fabián Ruiz','Fabián Ruiz Peña','Paris Saint-Germain',null),
(84,'F. Dimarco','Federico Dimarco','Inter',null),
(85,'G. Xhaka','Granit Xhaka','Sunderland',null),
(86,'Unai Simón','Unai Simón','Athletic Club',null),
(87,'P. Gulácsi','Péter Gulácsi','RB Leipzig',null),
(88,'M. Neuer','Manuel Neuer','Bayern München',null),
(89,'J. Pickford','Jordan Pickford','Everton',null),
(90,'W. Szczęsny','Wojciech Szczęsny','Barcelona',null),
(91,'Álex Baena','Alejandro Baena Rodríguez','Atlético Madrid',null),
(92,'B. Barcola','Bradley Barcola','Paris Saint-Germain',null),
(93,'X. Simons','Xavier Quentin Shay Simons','Tottenham Hotspur',null),
(94,'Sancet','Oihan Sancet Tirapu','Athletic Club',128398),
(95,'E. Fernández','Enzo Jeremías Fernández','Chelsea',5996),
(96,'J. Gvardiol','Joško Gvardiol','Manchester City',null),
(97,'A. Davies','Alphonso Boyle Davies','FC Bayern München',null),
(98,'E. Palacios','Exequiel Alejandro Palacios','Bayer 04 Leverkusen',null),
(99,'O. Marmoush','Omar Khaled Mohamed Marmoush','Manchester City',81573),
(100,'A. Tchouaméni','Aurélien Djani Tchouameni','Real Madrid',null),
(101,'Vivian','Daniel Vivian Moreno','Athletic Club',47278),
(102,'C. Gakpo','Cody Mathès Gakpo','Liverpool',null),
(103,'Rafael Leão','Rafael Alexandre da Conceição Leão','AC Milan',null),
(104,'Éder Militão','Éder Gabriel Militão','Real Madrid',null),
(105,'C. Pulisic','Christian Mate Pulišić','AC Milan',null),
(106,'Marc Cucurella','Marc Cucurella Saseta','Chelsea',null),
(107,'A. Lookman','Ademola Olajade Alade Aylola Lookman','Atalanta',null),
(108,'M. Locatelli','Manuel Locatelli','Juventus',null),
(109,'J. Maddison','James Daniel Maddison','Tottenham Hotspur',null),
(110,'A. Sørloth','Alexander Sørloth','Atlético Madrid',null),
(111,'O. Watkins','Oliver George Arthur Watkins','Aston Villa',null),
(112,'Grimaldo','Alejandro Grimaldo García','Bayer 04 Leverkusen',563),
(113,'Bernardo Silva','Bernardo Mota Veiga de Carvalho e Silva','Manchester City',null),
(114,'M. Zaccagni','Mattia Zaccagni','Lazio',null),
(115,'G. Mamardashvili','Giorgi Mamardashvili','Liverpool',null),
(116,'D. Dumfries','Denzel Justus Morris Dumfries','Inter',null),
(117,'Marcos Llorente','Marcos Llorente Moreno','Atlético Madrid',null),
(118,'B. Pavard','Benjamin Pavard','Olympique de Marseille',null),
(119,'R. Lukaku','Romelu Menama Lukaku Bolingoli','Napoli',null),
(120,'W. Orban','Vilmos Tamás Orbán','RB Leipzig',null),
(121,'Isco','Francisco Román Alarcón Suárez','Real Betis Balompié',null),
(122,'S. de Vrij','Stefan de Vrij','Inter',null),
(123,'F. Acerbi','Francesco Acerbi','Inter',null),
(124,'M. Carnesecchi','Marco Carnesecchi','Atalanta',null),
(125,'E. Camavinga','Eduardo Celmi Camavinga','Real Madrid',null),
(126,'Gavi','Pablo Martín Páez Gavira','FC Barcelona',null),
(127,'H. Ekitiké','Hugo Ekitiké','Liverpool',null),
(128,'P. Hincapié','Piero Martín Hincapié Reyna','Arsenal',null),
(129,'D. Szoboszlai','Dominik Szoboszlai','Liverpool',null),
(130,'A. Gordon','Anthony Michael Gordon','Newcastle United',null),
(131,'Balde','Alejandro Balde Martínez','FC Barcelona',161928),
(132,'M. Kean','Moise Bioty Kean','Fiorentina',null),
(133,'Ferran Torres','Ferran Torres García','FC Barcelona',null),
(134,'Murillo','Murillo Santiago Costa dos Santos','Nottingham Forest',null),
(135,'A. Stiller','Angelo Stiller','VfB Stuttgart',null),
(136,'L. Openda','Ikoma Loïs Openda','Juventus',null),
(137,'Zubimendi','Martín Zubimendi Ibáñez','Arsenal',47315),
(138,'Matheus Cunha','Matheus Santos Carneiro da Cunha','Manchester United',null),
(139,'J. Frimpong','Jeremie Agyekum Frimpong','Liverpool',null),
(140,'R. Araujo','Ronald Federico Araújo da Silva','FC Barcelona',null),
(141,'E. Eze','Eberechi Oluchi Eze','Arsenal',null),
(142,'B. Kamara','Boubacar Bernard Kamara','Aston Villa',1904),
(143,'D. Hancko','Dávid Hancko','Atlético Madrid',null),
(144,'A. Dovbyk','Artem DovbykДовбик Артем Олександрович','Roma',null),
(145,'R. Le Normand','Robin Le Normand','Atlético Madrid',null),
(146,'Aleix García','Aleix García Serrano','Bayer 04 Leverkusen',null),
(147,'N. Milenković','Nikola Milenković','Nottingham Forest',null),
(148,'J. Bowen','Jarrod Bowen','West Ham United',null),
(149,'J. Brandt','Julian Brandt','Borussia Dortmund',null),
(150,'Mikel Merino','Mikel Merino Zazón','Arsenal',null),
(151,'L. Trossard','Leandro Trossard','Arsenal',null),
(152,'A. Rabiot','Adrien Rabiot-Provost','AC Milan',null),
(153,'B. White','Benjamin William White','Arsenal',null),
(154,'S. Lobotka','Stanislav Lobotka','Napoli',null),
(155,'Palhinha','João Maria Lobo Alves Palhinha Gonçalves','Tottenham Hotspur',41104),
(156,'G. Mancini','Gianluca Mancini','Roma',null),
(157,'Ayoze','Ayoze Pérez Gutiérrez','Villarreal CF',18906),
(158,'J. Giménez','José María Giménez de Vargas','Atlético Madrid',null),
(159,'N. Aké','Nathan Benjamin Aké','Manchester City',null),
(160,'Iñaki Williams','Iñaki Williams Arthuer','Athletic Club',47294),
(161,'M. Kovačić','Mateo Kovačić','Manchester City',null),
(162,'G. Di Lorenzo','Giovanni Di Lorenzo','Napoli',null),
(163,'A. Rrahmani','Amir Kadri Rrahmani','Napoli',null),
(164,'T. Partey','Thomas Teye Partey','Villarreal CF',null),
(165,'Iago Aspas','Iago Aspas Juncal','RC Celta',null),
(166,'H. Mkhitaryan','Henrikh Mkhitaryan','Inter',null),
(167,'L. Modrić','Luka Modrić','AC Milan',null),
(168,'D. Huijsen','Dean Donny Huijsen','Real Madrid',null),
(169,'Savinho','Sávio Moreira de Oliveira','Manchester City',266657),
(170,'M. Tillman','Malik Leon Tillman','Bayer 04 Leverkusen',null),
(171,'M. Rogers','Morgan Elliot Rogers','Aston Villa',null),
(172,'C. De Ketelaere','Charles De Ketelaere','Atalanta',null),
(173,'M. Greenwood','Mason Will John Greenwood','Olympique de Marseille',null),
(174,'T. Kubo','Takefusa Kubo久保 建英','Real Sociedad',null),
(175,'J. Burkardt','Jonathan Michael Burkardt','Eintracht Frankfurt',null),
(176,'M. Kerkez','Milos KerkezМилош Керкез','Liverpool',null),
(177,'D. Vlahović','Dušan VlahovićДушан Влаховић','Juventus',null),
(178,'J. David','Jonathan Christian David','Juventus',null),
(179,'Pau Cubarsí','Pau Cubarsí Paredes','FC Barcelona',null),
(180,'Éderson','Éderson José dos Santos Lourenço da Silva','Atalanta',null),
(181,'F. Nmecha','Felix Kalu Nmecha','Borussia Dortmund',null),
(182,'J. Timber','Jurriën David Norman Timber','Arsenal',null),
(183,'K. Havertz','Kai Lukas Havertz','Arsenal',null),
(184,'M. Gibbs-White','Morgan Anthony Gibbs-White','Nottingham Forest',null),
(185,'A. Buongiorno','Alessandro Buongiorno','Napoli',null),
(186,'M. van de Ven','Micky van de Ven','Tottenham Hotspur',null),
(187,'Pedro Porro','Pedro Antonio Porro Sauceda','Tottenham Hotspur',null),
(188,'Brahim','Brahim Abdelkader Díazابراهيم عبد القادر دياز','Real Madrid',744),
(189,'M. Guendouzi','Mattéo Elias Kenzo Guendouzi Olié','Lazio',null),
(190,'S. Botman','Sven Adriaan Botman','Newcastle United',null),
(191,'M. Guéhi','Addji Keaninkin Marc-Israel Guéhi','Crystal Palace',null),
(192,'M. de Ligt','Matthijs de Ligt','Manchester United',null),
(193,'R. Doan','Ritsu Doan堂安 律','Eintracht Frankfurt',null),
(194,'C. Romero','Cristian Gabriel Romero','Tottenham Hotspur',null),
(195,'D. Raum','David Raum','RB Leipzig',null),
(196,'Y. Wissa','Yoane Wissa','Newcastle United',null),
(197,'Oyarzabal','Mikel Oyarzabal Ugarte','Real Sociedad',47323),
(198,'J. Mateta','Jean-Philippe Mateta','Crystal Palace',null),
(199,'E. Konsa','Ezri Konsa Ngoyo','Aston Villa',null),
(200,'K. Mitoma','Kaoru Mitoma三笘 薫','Brighton & Hove Albion',null)
), normalized as (
 select c.*,lower(regexp_replace(extensions.unaccent(short_name),'[^a-zA-Z0-9]+','','g')) sn,lower(regexp_replace(extensions.unaccent(long_name),'[^a-zA-Z0-9]+','','g')) ln from candidates c
), resolved as (
 select n.star_priority,coalesce(n.forced_id,p.api_football_id) api_football_id,n.long_name label
 from normalized n
 left join lateral (
  select p.api_football_id from public.players p
  where n.forced_id is null and p.api_football_id is not null and lower(regexp_replace(extensions.unaccent(p.full_name),'[^a-zA-Z0-9]+','','g')) in(n.sn,n.ln)
  order by p.active desc limit 1
 ) p on true
)
insert into public.player_stardom_overrides(api_football_id,star_priority,label)
select api_football_id,star_priority,label from resolved;

create or replace function public.finalize_api_football_draft_pool(p_api_ids jsonb) returns integer
language plpgsql security definer set search_path=''
as $f$
declare v_count integer;
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'Server access required'; end if;
 if jsonb_typeof(p_api_ids)<>'array' or jsonb_array_length(p_api_ids)>3000 then raise exception 'Invalid API player pool'; end if;
 update public.players set active=false,draft_rank=null where active=true or draft_rank is not null;
 with perf as (
   select (value#>>'{}')::bigint api_id,ordinality::integer performance_rank from jsonb_array_elements(p_api_ids) with ordinality
 ), pool as (
   select api_id,performance_rank from perf
   union all
   select o.api_football_id,null::integer from public.player_stardom_overrides o
   where not exists(select 1 from perf where perf.api_id=o.api_football_id)
 ), c as (
   select p.id,o.star_priority,
   (case p.club
    when 'Real Madrid' then 1000 when 'Barcelona' then 980 when 'Manchester City' then 970 when 'Liverpool' then 960
    when 'Bayern München' then 950 when 'Paris Saint Germain' then 945 when 'Arsenal' then 940 when 'Inter' then 920
    when 'Chelsea' then 900 when 'Manchester United' then 890 when 'Juventus' then 885 when 'AC Milan' then 880
    when 'Atletico Madrid' then 875 when 'Borussia Dortmund' then 870 when 'Tottenham' then 850 when 'Napoli' then 845
    when 'Atalanta' then 830 when 'Aston Villa' then 825 when 'Newcastle' then 820 when 'RB Leipzig' then 815
    when 'Bayer Leverkusen' then 810 else 500 end
    +case p.position when 'FWD' then 80 when 'MID' then 55 when 'DEF' then 25 else 10 end
    +greatest(0,500-coalesce(pool.performance_rank,3000))) score,pool.performance_rank
   from pool join public.players p on p.api_football_id=pool.api_id
   left join public.player_stardom_overrides o on o.api_football_id=p.api_football_id
 ), ordered as (
   select id,row_number() over(order by case when star_priority is not null then 0 else 1 end,
   star_priority nulls last,score desc,performance_rank nulls last,id)::integer new_rank from c
 )
 update public.players p set active=true,draft_rank=o.new_rank from ordered o where p.id=o.id;
 select count(*) into v_count from public.players where active and api_football_id is not null;
 return v_count;
end $f$;
revoke all on function public.finalize_api_football_draft_pool(jsonb) from public,anon,authenticated;
grant execute on function public.finalize_api_football_draft_pool(jsonb) to service_role;

update public.players set active=false,draft_rank=-draft_rank where active and draft_rank is not null;
with perf as (
 select api_football_id,abs(draft_rank)::integer performance_rank from public.players where draft_rank<0 and api_football_id is not null
), pool as (
 select api_football_id,performance_rank from perf
 union all select o.api_football_id,null::integer from public.player_stardom_overrides o
 where not exists(select 1 from perf where perf.api_football_id=o.api_football_id)
), c as (
 select p.id,o.star_priority,
 (case p.club when 'Real Madrid' then 1000 when 'Barcelona' then 980 when 'Manchester City' then 970 when 'Liverpool' then 960 when 'Bayern München' then 950 when 'Paris Saint Germain' then 945 when 'Arsenal' then 940 when 'Inter' then 920 when 'Chelsea' then 900 when 'Manchester United' then 890 when 'Juventus' then 885 when 'AC Milan' then 880 when 'Atletico Madrid' then 875 when 'Borussia Dortmund' then 870 when 'Tottenham' then 850 when 'Napoli' then 845 when 'Atalanta' then 830 when 'Aston Villa' then 825 when 'Newcastle' then 820 when 'RB Leipzig' then 815 when 'Bayer Leverkusen' then 810 else 500 end
 +case p.position when 'FWD' then 80 when 'MID' then 55 when 'DEF' then 25 else 10 end
 +greatest(0,500-coalesce(pool.performance_rank,3000))) score,pool.performance_rank
 from pool join public.players p on p.api_football_id=pool.api_football_id
 left join public.player_stardom_overrides o on o.api_football_id=p.api_football_id
), ordered as (
 select id,row_number() over(order by case when star_priority is not null then 0 else 1 end,star_priority nulls last,score desc,performance_rank nulls last,id)::integer new_rank from c
)
update public.players p set active=true,draft_rank=o.new_rank from ordered o where p.id=o.id;
update public.players set draft_rank=null where not active;
commit;
