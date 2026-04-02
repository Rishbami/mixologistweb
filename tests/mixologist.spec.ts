import { expect, test, type Page } from "@playwright/test";
import { mixologistFixture } from "../lib/testing/mixologist-fixture";

async function gotoWithFixture(page: Page) {
  await page.goto("/?fixture=mixologist");
  await page.evaluate((fixture) => {
    window.__MIXOLOGIST_FIXTURE__ = fixture;
    window.localStorage.setItem("__MIXOLOGIST_FIXTURE__", JSON.stringify(fixture));
  }, mixologistFixture);
}

test("shows fixture-backed ingredient buttons and empty-state guidance", async ({ page }) => {
  await gotoWithFixture(page);

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
  await gotoWithFixture(page);

  await page.getByRole("button", { name: "Gin" }).click();
  await page.getByRole("button", { name: "Campari" }).click();

  await expect(page.getByText("2 selected")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Can make" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Could make" })).toBeVisible();
  await expect(page.getByText("Negroni")).toBeVisible();
  await expect(page.getByText("Missing: Sweet Vermouth")).toHaveCount(2);
  await expect(page.getByAltText("Negroni")).toBeVisible();
  await expect(page.getByText("No Image")).toHaveCount(1);

  await page.getByRole("button", { name: "Sweet Vermouth" }).click();

  await expect(page.getByText("3 selected")).toBeVisible();
  await expect(page.getByText("Negroni")).toBeVisible();
  await expect(page.getByText("Gin and It")).toBeVisible();
  await expect(page.getByText("Missing: Sweet Vermouth")).toHaveCount(0);
  await expect(page.getByAltText("Negroni")).toBeVisible();
  await expect(page.getByText("No Image")).toHaveCount(1);
});

test("filters ingredients by search and clears the active selection", async ({ page }) => {
  await gotoWithFixture(page);

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

test("renders cocktail thumbnails on result cards when images are available", async ({ page }) => {
  await gotoWithFixture(page);

  await page.getByRole("button", { name: "Vodka" }).click();
  await page.getByRole("button", { name: "Cranberry Juice" }).click();
  await page.getByRole("button", { name: "Triple Sec" }).click();

  await expect(page.getByText("1 one away")).toBeVisible();
  await expect(page.getByText("Cosmopolitan")).toBeVisible();

  const cosmopolitanImage = page.getByAltText("Cosmopolitan");
  await expect(cosmopolitanImage).toBeVisible();
  await expect(cosmopolitanImage).toHaveAttribute("src", /cosmopolitan\.jpg/);
});
