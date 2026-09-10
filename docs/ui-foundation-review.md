# UI foundation review

Release branch: `release/ui-foundation`, based on production `f1e0dc13`. Only cosmetic commit `298be35` was cherry-picked from the original repair branch. Existing production repairs are preserved. The user authorized push and production deployment on September 10, 2026.

## Changes

- Keep the stadium identity and dark green/cream palette; simplify shared panels and neutral badges.
- Correct light-theme inheritance on the permanently dark login screen. Improve labels, input sizes, button contrast and selected-state accessibility.
- Move the existing Home action card ahead of matchups in DOM and visual order. Keep its existing action-selection logic.
- Add current transaction week/phase context and correctly name the link to league management.
- Increase dashboard text, scores, table spacing, navigation labels and primary control sizes. Stack action links on narrow screens.
- Label non-final active matchup totals Provisional, with an explanation. The database live flag cannot reliably distinguish ongoing matches from pending verification; this UI deliberately does not invent that distinction.
- Explain that standings include finalized matchups only. No scoring, finalization, query or database behavior changed.
- Add accessible names to gameweek arrows and prevent Space from scrolling when opening player details.

## Verification

- TypeScript check passed.
- Production build passed (26 static pages generated).
- Git whitespace check passed.
- React review: no new effects, dependencies, requests or state introduced; action order follows DOM order, toggle buttons expose pressed states.
- Browser verification attempted; the cloud browser rejected localhost with ERR_BLOCKED_BY_CLIENT. Rendered desktop/mobile checks remain outstanding. No authenticated visual sign-off is claimed.

Before release, inspect login/signup in both language settings, Home with a long league/team name and urgent action, and scheduled/provisional/final matchups at 375px, 768px and 1440px in both themes. Check shared panel/badge changes on Team, Players, Waivers and Trades. This batch is ready for code review, not visual release sign-off.

The detailed lineup, market and waiver redesigns remain later batches.
