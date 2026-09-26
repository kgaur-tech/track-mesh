import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { apiError } from "@/lib/http";

const registrationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(320),
  password: z.string().min(10).max(128),
});

export async function POST(request: Request) {
  try {
    const data = registrationSchema.parse(await request.json());
    const email = data.email.toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) return NextResponse.json({ error: "An account already exists for this email" }, { status: 409 });

    await prisma.user.create({
      data: {
        email,
        name: data.name,
        passwordHash: await hashPassword(data.password),
        role: "PARTICIPANT",
      },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
