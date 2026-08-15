import { createClient } from "@supabase/supabase-js";

const projectUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://ocabrgbrkqmsnalbfzvx.supabase.co";
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_DA08c5KwmYXpru6CdrRfHA_4Qe2z3M-";

export const isSupabaseConfigured = Boolean(projectUrl && publishableKey);
export const supabase = createClient(projectUrl, publishableKey, {
  auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true },
});
