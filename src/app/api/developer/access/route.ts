import { NextRequest, NextResponse } from "next/server";
import { isDeveloperRequest } from "@/lib/developer-auth";

export async function GET(request: NextRequest) {
  const allowed = await isDeveloperRequest(request);
  return NextResponse.json(
    { allowed },
    { status: allowed ? 200 : 403, headers: { "Cache-Control": "no-store" } },
  );
}
