import { expect, test } from "@playwright/test";

test("dashboard loads with demo project fallback", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Electrical design/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nova Tower Prototype", level: 2 })).toBeVisible();
});

test("telegram setup page exposes webhook controls", async ({ page }) => {
  await page.goto("/telegram");
  await expect(page.getByRole("heading", { name: "Telegram Setup" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Check Status/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Register Webhook/i })).toBeVisible();
});

test("demo project exposes guarded delete control", async ({ page }) => {
  await page.goto("/project/demo-project");
  await expect(page.getByRole("button", { name: /Delete Project/i })).toBeVisible();
});

test("project chat page degrades without xAI credentials", async ({ page }) => {
  await page.goto("/project/demo-project/chat");
  await page.getByPlaceholder("Ask about the current design...").fill("What is the current floor status?");
  await page.getByRole("button", { name: /Send/i }).click();
  await expect(page.getByText(/xAI is not configured locally|Nova Tower Prototype/i)).toBeVisible();
});
