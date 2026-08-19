import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

type SignupBody = { name?: string; email?: string; password?: string; betaCode?: string };

function codesMatch(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as SignupBody;
  const name = body.name?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  const betaCode = body.betaCode?.trim() ?? "";
  const expectedCode = process.env.BETA_ACCESS_CODE;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ocabrgbrkqmsnalbfzvx.supabase.co";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!expectedCode || !serviceRoleKey) return NextResponse.json({ error: "Beta signup is temporarily unavailable." }, { status: 503 });
  if (!codesMatch(betaCode, expectedCode)) return NextResponse.json({ error: "That beta access code isn’t valid." }, { status: 403 });
  if (name.length < 2 || name.length > 40 || !email || password.length < 8) return NextResponse.json({ error: "Complete every account field before continuing." }, { status: 400 });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error || !data.user) return NextResponse.json({ error: error?.message ?? "Your account could not be created." }, { status: 400 });

  const { error: approvalError } = await admin.from("profiles").update({ beta_access_granted_at: new Date().toISOString() }).eq("id", data.user.id);
  if (approvalError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return NextResponse.json({ error: "Your beta access could not be saved. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
