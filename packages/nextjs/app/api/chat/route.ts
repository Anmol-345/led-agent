import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "The generic chat path has been replaced by the authenticated Value-Investing Advisor. Use /api/advisor/quote and /api/advisor/run for cited investment research.",
    },
    { status: 400 }
  );
}
