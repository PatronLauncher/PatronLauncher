import { test, expect } from "@playwright/test";
import {
  versionFamily,
  families,
  orderFamilies,
  type CatalogVersion,
} from "../src/versions";
const v = (
  id: string,
  type = "release",
  releaseTime = "2024-01-01",
): CatalogVersion => ({
  id,
  type,
  url: "",
  sha1: "",
  releaseTime,
  installed: false,
});
test("one family rule handles base versions, patches, new numbering and snapshots", () => {
  for (const id of ["1.18", "1.18.1", "1.18.2", "1.18-pre1"])
    expect(versionFamily(v(id))).toBe("1.18");
  for (const id of ["26.1", "26.2", "26.3", "26.1-snapshot-1"])
    expect(versionFamily(v(id))).toBe("26");
  expect(versionFamily(v("24w14a", "snapshot"))).toBe("Snapshot");
  expect(versionFamily(v("a1.2.6", "old_alpha"))).toBe("Alpha");
  expect(versionFamily(v("b1.7.3", "old_beta"))).toBe("Beta");
});
test("filters preserve actual patches; date ordering avoids 1.9/1.10 numeric errors", () => {
  const all = [
    v("1.9", "release", "2016-01-01"),
    v("1.10", "release", "2016-06-01"),
    v("1.18"),
    v("1.18.2"),
    v("24w14a", "snapshot"),
    v("a1.2.6", "old_alpha"),
    v("b1.7.3", "old_beta"),
  ];
  const release = families(all, false, false);
  expect(release.map((f) => f.id)).toEqual(["1.9", "1.10", "1.18"]);
  expect(release[2].versions.map((v) => v.id)).toEqual(["1.18.2", "1.18"]);
  expect(families(all, true, true)).toHaveLength(6);
  expect(orderFamilies(release, "oldest").map((f) => f.id)).toEqual([
    "1.9",
    "1.10",
    "1.18",
  ]);
  expect(orderFamilies(release, "newest").map((f) => f.id)).toEqual([
    "1.18",
    "1.10",
    "1.9",
  ]);
  expect(all).toHaveLength(7);
});
