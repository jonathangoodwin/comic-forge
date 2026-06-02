import { Liveblocks } from "@liveblocks/node";
import { NextRequest, NextResponse } from "next/server";

const liveblocks = new Liveblocks({
  secret: process.env.LIVEBLOCKS_SECRET_KEY || "",
});

export async function POST(request: NextRequest) {
  const { room } = await request.json();
  const session = liveblocks.prepareSession(
    `user-${Math.random().toString(36).slice(2)}`,
    { userInfo: { name: "Anonymous" } }
  );
  session.allow(room, session.FULL_ACCESS);
  const { body, status } = await session.authorize();
  return new NextResponse(body, { status });
}
