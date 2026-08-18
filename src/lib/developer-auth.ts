import type { NextRequest } from "next/server";

const DEVELOPER_EMAIL = (
  process.env.DEVELOPER_ACCOUNT_EMAIL ?? "carloshernandezave256@gmail.com"
).toLowerCase();

type AuthUser = { email?: string | null };

export function isDeveloperEmail(email?: string | null) {
  return email?.toLowerCase() === DEVELOPER_EMAIL;
}

export async function isDeveloperRequest(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "sb_publishable_DA08c5KwmYXpru6CdrRfHA_4Qe2z3M-";
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: authorization },
    cache: "no-store",
  });
  if (!response.ok) return false;

  const user = (await response.json()) as AuthUser;
  return isDeveloperEmail(user.email);
}
