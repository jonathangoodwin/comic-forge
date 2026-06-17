import { test, expect } from "@playwright/test";

test.describe("Sharing feature", () => {
  test("auto-generates a room ID in the URL on first visit", async ({ page }) => {
    await page.goto("/comic-editor");
    await expect(page).toHaveURL(/[?&]room=[a-f0-9]{8}/);
  });

  test("Share button is visible in the header", async ({ page }) => {
    await page.goto("/comic-editor");
    const shareBtn = page.getByRole("button", { name: "Share" });
    await expect(shareBtn).toBeVisible();
  });

  test("Share button copies a URL with the room ID to clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/comic-editor");

    // Wait for the room ID to be written into the URL by the useEffect
    await expect(page).toHaveURL(/[?&]room=[a-f0-9]{8}/);
    const url = new URL(page.url());
    const roomId = url.searchParams.get("room");
    expect(roomId).toMatch(/^[a-f0-9]{8}$/);

    await page.getByRole("button", { name: "Share" }).click();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain(`room=${roomId}`);
  });

  test("visiting a share URL preserves the room ID", async ({ page }) => {
    const roomId = "abcd1234";
    await page.goto(`/comic-editor?room=${roomId}`);
    await expect(page).toHaveURL(new RegExp(`room=${roomId}`));

    // The URL should not be replaced with a new room
    const finalUrl = new URL(page.url());
    expect(finalUrl.searchParams.get("room")).toBe(roomId);
  });

  test("sync status dot shows connecting or connected when PartyKit host is configured", async ({ page }) => {
    await page.goto("/comic-editor");
    await expect(page).toHaveURL(/[?&]room=[a-f0-9]{8}/);
    // With NEXT_PUBLIC_PARTYKIT_HOST set the dot should leave offline state
    const dot = page.locator("span[title='connecting'], span[title='connected']");
    await expect(dot).toBeVisible({ timeout: 10_000 });
  });

  test("two tabs with the same room ID share the same URL structure", async ({ context }) => {
    const page1 = await context.newPage();
    await page1.goto("/comic-editor");
    await expect(page1).toHaveURL(/[?&]room=[a-f0-9]{8}/);
    const roomId = new URL(page1.url()).searchParams.get("room")!;

    const shareUrl = `http://localhost:3006/comic-editor?room=${roomId}`;
    const page2 = await context.newPage();
    await page2.goto(shareUrl);

    expect(new URL(page2.url()).searchParams.get("room")).toBe(roomId);

    await page1.close();
    await page2.close();
  });

  test("live sync: both tabs reach connected state in the same room", async ({ context }) => {
    const page1 = await context.newPage();
    await page1.goto("/comic-editor");
    await expect(page1).toHaveURL(/[?&]room=[a-f0-9]{8}/);
    const roomId = new URL(page1.url()).searchParams.get("room")!;

    const page2 = await context.newPage();
    await page2.goto(`http://localhost:3006/comic-editor?room=${roomId}`);

    // Both tabs should reach "connected" state (green dot)
    await expect(page1.locator("span[title='connected']")).toBeVisible({ timeout: 15_000 });
    await expect(page2.locator("span[title='connected']")).toBeVisible({ timeout: 15_000 });

    await page1.close();
    await page2.close();
  });
});
