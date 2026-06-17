import { test as setup, expect } from "@playwright/test";
import { prisma } from "../lib/prisma";
import { encode } from "next-auth/jwt";

const TEST_EMAIL = "test@comic-forge.local";
const STORAGE_STATE = "tests/.auth/user.json";

setup("create authenticated session", async ({ page }) => {
  const user = await prisma.user.upsert({
    where: { email: TEST_EMAIL },
    update: {},
    create: { email: TEST_EMAIL, emailVerified: new Date() },
  });

  // Mint a NextAuth JWT directly so the middleware accepts it
  const token = await encode({
    token: { sub: user.id, email: user.email, name: user.name },
    secret: process.env.NEXTAUTH_SECRET!,
  });

  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24);

  await page.context().addCookies([
    {
      name: "next-auth.session-token",
      value: token,
      domain: "localhost",
      path: "/",
      expires: Math.floor(expires.getTime() / 1000),
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto("/");
  await expect(page).toHaveURL("/");

  await page.context().storageState({ path: STORAGE_STATE });
});
