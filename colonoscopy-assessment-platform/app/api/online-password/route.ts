import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.ASSESSMENT_DEPLOYMENT_MODE === "local") {
    return NextResponse.json({ error: "Online password is unavailable." }, { status: 404 });
  }

  const expectedPassword = process.env.STUDY_SHARED_PASSWORD;
  if (!expectedPassword) {
    return NextResponse.json(
      { error: "Online study password is not configured." },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const providedPassword =
    typeof body === "object" && body !== null && "password" in body
      ? body.password
      : undefined;

  if (typeof providedPassword !== "string" || providedPassword !== expectedPassword) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  return NextResponse.json({ authorized: true });
}
