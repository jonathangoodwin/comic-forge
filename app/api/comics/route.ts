import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json([], { status: 401 });

  const comics = await prisma.comic.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json(comics);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({}, { status: 401 });

  const { title } = await req.json().catch(() => ({}));
  const roomId = crypto.randomUUID().slice(0, 8);

  const comic = await prisma.comic.create({
    data: {
      title: title || "Untitled Comic",
      roomId,
      userId: session.user.id,
    },
  });
  return NextResponse.json(comic, { status: 201 });
}
