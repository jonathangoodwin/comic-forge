import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function ownsComic(userId: string, id: string) {
  const comic = await prisma.comic.findFirst({ where: { id, userId } });
  return comic;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({}, { status: 401 });

  const comic = await ownsComic(session.user.id, params.id);
  if (!comic) return NextResponse.json({}, { status: 404 });

  const { title } = await req.json();
  const updated = await prisma.comic.update({
    where: { id: params.id },
    data: { title, updatedAt: new Date() },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({}, { status: 401 });

  const comic = await ownsComic(session.user.id, params.id);
  if (!comic) return NextResponse.json({}, { status: 404 });

  await prisma.comic.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
