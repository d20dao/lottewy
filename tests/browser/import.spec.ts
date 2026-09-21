import { test, expect } from "@playwright/test";
test("CSV selects one column locally, appends, replaces explicitly and supports undo", async ({
  page,
}) => {
  const posts: string[] = [];
  const uploadedCsv: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).origin === new URL(page.url()).origin
    )
      posts.push(r.url());
    if (
      /alex@example\.com|jordan@example\.com|private note|second note/.test(
        r.postData() || "",
      )
    )
      uploadedCsv.push(r.url());
  });
  await page.goto("/create");
  await page.getByLabel("Entry list").fill("Existing One\nExisting Two");
  await page
    .getByLabel("Giveaway title", { exact: true })
    .fill("Keep this title");
  await page.getByRole("button", { name: "Import CSV or spreadsheet" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "members.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      'Name,Email,Note\r\n"Smith, Alex",alex@example.com,private note\r\nJordan,jordan@example.com,second note',
    ),
  });
  await expect(page.getByLabel("First row contains headers")).toBeChecked();
  await page.getByLabel("Entry column", { exact: true }).selectOption("1");
  await expect(page.locator(".csv-values")).toContainText("alex@example.com");
  await expect(page.locator(".csv-values")).not.toContainText("private note");
  await page
    .getByRole("button", { name: "Add 2 entries", exact: false })
    .click();
  await expect(page.getByLabel("Entry list")).toHaveValue(
    "Existing One\nExisting Two\nalex@example.com\njordan@example.com",
  );
  await expect(page.getByLabel("Giveaway title", { exact: true })).toHaveValue(
    "Keep this title",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Entry list")).toHaveValue(
    "Existing One\nExisting Two",
  );
  await page.getByRole("button", { name: "Import CSV or spreadsheet" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "names.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Name\nAlex\nJordan"),
  });
  await page.getByLabel("Replace the current list").check();
  await page.getByRole("button", { name: "Replace with 2 entries" }).click();
  await expect(page.getByLabel("Entry list")).toHaveValue("Alex\nJordan");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Entry list")).toHaveValue(
    "Existing One\nExisting Two",
  );
  expect(posts).toEqual([]);
  expect(uploadedCsv).toEqual([]);
});
test("pasted spreadsheet preview handles multiline cells without multiplying entries", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/create");
  await page.getByRole("button", { name: "Import CSV or spreadsheet" }).click();
  await page.getByText("Or paste cells from a spreadsheet").click();
  await page
    .getByLabel("Spreadsheet cells")
    .fill(
      'Name\tEmail\n"Alex\nSmith"\talex@example.com\nJordan\tjordan@example.com',
    );
  await page.getByRole("button", { name: "Read pasted cells" }).click();
  await page.getByLabel("Entry column", { exact: true }).selectOption("0");
  await expect(page.getByText(/contain line breaks/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add 2 entries", exact: false }),
  ).toBeDisabled();
  await page.getByLabel("Entry column", { exact: true }).selectOption("1");
  await expect(
    page.getByRole("button", { name: "Add 2 entries", exact: false }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/import-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Add 2 entries", exact: false })
    .click();
  await expect(page.getByLabel("Entry list")).toHaveValue(
    "alex@example.com\njordan@example.com",
  );
});
test("duplicate repair references actual lines, preserves order and can be undone", async ({
  page,
}) => {
  await page.goto("/create");
  await page.getByLabel("Entry list").fill("\nAlex\n\nJordan\nAlex");
  await expect(page.getByText("Line 5 repeats line 2")).toBeVisible();
  await page.getByRole("button", { name: "Find in list" }).click();
  expect(
    await page
      .getByLabel("Entry list")
      .evaluate((e: HTMLTextAreaElement) =>
        e.value.substring(e.selectionStart, e.selectionEnd),
      ),
  ).toBe("Alex");
  await page.getByRole("button", { name: "Remove 1 repeated entry" }).click();
  await expect(page.getByLabel("Entry list")).toHaveValue("Alex\nJordan");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Entry list")).toHaveValue(
    "\nAlex\n\nJordan\nAlex",
  );
});
