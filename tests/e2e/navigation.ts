import { expect, type Page } from "@playwright/test";
/** Use the same contextual navigation as an owner; never force hidden controls. */
export async function openProjectTools(page: Page) {
  const section = page.locator("details.rail-tools");
  const summary = section.locator("summary").first();
  await expect(summary).toBeAttached();
  if (!(await summary.isVisible())) {
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  }
  await expect(summary).toBeVisible();
  if (
    !(await section.evaluate((element) => (element as HTMLDetailsElement).open))
  ) {
    await summary.click();
  }
}
