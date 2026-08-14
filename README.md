# XI — Cross-League Fantasy Soccer

An independent mobile-first implementation of Carlos's fantasy soccer concept.

## First checkpoint

- Responsive home dashboard with light/dark themes
- Head-to-head matchup and league-table prototype
- Itemized scoring audit ledger
- Tested custom scoring engine
- Initial Supabase schema for profiles, leagues, memberships, players, drafts, and exclusive ownership

## Local development

```bash
npm install
npm run test
npm run dev
```

The SQL file is a reviewed starting point only. Do not apply it to production until league-scoped RLS and draft RPC behavior are complete.
