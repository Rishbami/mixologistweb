import { expect, test } from "@playwright/test";
import { mixologistFixture } from "./fixtures/mixologist-fixture";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((fixture) => {
    window.__MIXOLOGIST_FIXTURE__ = fixture;
  }, mixologistFixture);
});

test("shows fixture-backed ingredient buttons and empty-state guidance", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Pick what you’ve got. We’ll tell you what’s pourable." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Gin" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Campari" })).toBeVisible();
  await expect(page.getByText("0 selected")).toBeVisible();
  await expect(
    page.getByText("Start by selecting an ingredient. Once you do, your makeable cocktails will appear here."),
  ).toBeVisible();
});

test("updates can-make and could-make lists as ingredients are selected", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Gin" }).click();
  await page.getByRole("button", { name: "Campari" }).click();

  await expect(page.getByText("2 selected")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Can make" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Could make" })).toBeVisible();
  await expect(page.getByText("Negroni")).toBeVisible();
  await expect(page.getByText("Missing: Sweet Vermouth")).toHaveCount(2);

  await page.getByRole("button", { name: "Sweet Vermouth" }).click();

  await expect(page.getByText("3 selected")).toBeVisible();
  await expect(page.getByText("Negroni")).toBeVisible();
  await expect(page.getByText("Gin and It")).toBeVisible();
  await expect(page.getByText("Missing: Sweet Vermouth")).toHaveCount(0);
});

test("filters ingredients by search and clears the active selection", async ({ page }) => {
  await page.goto("/");

  await page.getByPlaceholder("Search ingredients").fill("cran");
  await expect(page.getByRole("button", { name: "Cranberry Juice" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gin" })).not.toBeVisible();

  await page.getByRole("button", { name: "Cranberry Juice" }).click();
  await expect(page.getByText("1 selected")).toBeVisible();

  await page.getByRole("button", { name: "Clear selection" }).click();

  await expect(page.getByText("0 selected")).toBeVisible();
  await expect(page.getByPlaceholder("Search ingredients")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Gin" })).toBeVisible();
});
