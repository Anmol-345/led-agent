import { NextResponse } from "next/server";

import { CheckupService } from "@/lib/advisor/checkup";
import { getAdvisorConfig } from "@/lib/advisor/service";
import { getAdvisorPrismaClient } from "@/lib/advisor/db";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    const config = getAdvisorConfig();
    const expectedSecret = process.env.ADVISOR_SCHEDULER_SECRET || "default_scheduler_secret_at_least_32_chars_long_for_test";

    if (!token || token !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized scheduler secret." }, { status: 401 });
    }

    const db = getAdvisorPrismaClient(config);
    const service = new CheckupService({ database: db });

    const result = await service.syncPendingCheckups({ now: new Date() });

    return NextResponse.json({ success: true, syncedCount: result.syncedCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync pending checkups.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
