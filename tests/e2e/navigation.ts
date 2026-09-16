import { expect, type Page } from "@playwright/test";
/** Open the selected project's contextual details through the owner-facing UI. */
export async function openProjectTools(
  page: Page,
  destination: "project" | "schedules" = "project",
) {
  const target =
    destination === "schedules"
      ? page.getByRole("button", { name: "Schedules", exact: true })
      : page
          .locator(".project-group")
          .filter({ has: page.locator(".project-button.selected") })
          .getByRole("button", { name: /^Project details for / });
  if (!(await target.isVisible()))
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await expect(target).toBeVisible();
  if (
    destination === "project" &&
    !(await page.getByRole("dialog", { name: /^Project details:/ }).isVisible())
  )
    await target.click();
}
