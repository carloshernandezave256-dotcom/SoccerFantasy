# Week 8 identity and scorer repair — 28 October 2026

Seven blocked identities were reviewed against fresh SportMonks player responses.
The existing Lahdo, Fofana and Antwi IDs, birth dates and clubs agreed; their cached
nationality fields were updated to the corroborated current provider values.
Matah Yondjio was linked to Angel Yondjo using the LOSC announcement and Opta's
explicit alternate-name profile. Three previously absent participants received
inactive scoring records: Christian Imga, Txus Vizcay and Lion Schweers. Existing
positions and ownership were preserved. Before/after evidence is retained in
private.scoring_repair_audit under 20261028-week8-reviewed-identities.

The reimport then exposed an independent SportMonks goal-total contradiction in
canonical fixture 1552796 / SportMonks 19715570: Marseille 4–3 Le Havre, 25 October
2026, 16:15 UTC. The provider timeline correctly gives Mouhamed Lamine Ndiaye the
86th-minute goal, but aggregate statistics also give Rassoul Ndiaye a goal after
he had left at minute 61. Le Havre's official report confirms Maja's two goals and
Lamine's one, and confirms both Ndiaye substitutions.

The normalizer removes only the extra Rassoul goal when the exact fixture,
canonical mapping, kickoff, final score, lineup identity, minutes, substitutions,
scorer event and companion scorer totals match the reviewed response. Normal
fixture/player goal reconciliation still runs. The raw provider response remains
unchanged; the completed import records a reviewed-evidence note. Later correct
provider statistics bypass the exception. Explicit nulls remain errors.

Validation replays the captured provider scoring payload, verifies all seven
legitimate goals, checks no payload mutation, rejects altered appearance/scorer
identities and confirms provenance is not emitted on a failed import.

Sources:

- https://hac.football/fr/posts/om-hac-4-3-le-miroir-a-deux-faces
- https://www.losc.fr/actualites/2025-07-17/le-jeune-espoir-camerounais-angel-yondjo-matah-rejoint-le-losc
- https://theanalyst.com/players/7562/matah-yondjio
- https://www.athletic-club.eus/en/news/2026/10/26/imga-and-vizcay-make-their-debuts-for-athletic-club/
- https://datencenter.dfb.de/datencenter/personen/lion-schweers/spieler
