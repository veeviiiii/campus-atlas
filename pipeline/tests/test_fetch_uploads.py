import json
import tempfile
import unittest
from pathlib import Path

from pipeline import fetch_uploads
from pipeline.desk.suggest import from_name
from pipeline.fetch_uploads import fetch, folder_for, mark, tag, tidy

USER = "11111111-2222-3333-4444-555555555555"


def upload(n: int, **changes) -> dict:
    return {
        "id": f"a3b0c9d{n}-0000-4000-8000-000000000000", "uploader": USER, "course_id": "mtech-aids-dual", "semester": 5,
        "subject": "Software Engineering", "exam_kind": "end", "session": "2024-25", "exam_month": None, "note": None,
        "page_count": 2, "status": "pending", "message": None, "answer": None, "pack_key": None, "created_at": "2026-11-16T10:00:00+00:00",
        **changes,
    }


class FakeApi:
    """Rows and files in memory; records what the script asked for."""

    def __init__(self, rows: list[dict], files: dict[str, bytes]) -> None:
        self.table, self.store, self.queries, self.downloads = rows, files, [], 0

    def rows(self, query: str) -> list[dict]:
        self.queries.append(query)
        if "or=(status.eq.pending,and(status.eq.held,answer.not.is.null))" in query:
            return [r for r in self.table if r["status"] == "pending" or (r["status"] == "held" and r["answer"])]
        if "status=in.(pending,held)" in query:
            return [r for r in self.table if r["status"] in ("pending", "held")]
        return list(self.table)

    def update(self, upload_id: str, changes: dict) -> list[dict]:
        hit = [r for r in self.table if r["id"] == upload_id]
        for r in hit:
            r.update(changes)
        return hit

    def files(self, folder: str) -> list[str]:
        depth = len(folder.split("/")) if folder else 0
        return sorted({p.split("/")[depth] for p in self.store if not folder or p.startswith(folder + "/")})

    def download(self, path: str) -> bytes:
        self.downloads += 1
        return self.store[path]

    def delete(self, paths: list[str]) -> None:
        for p in paths:
            del self.store[p]


class Keys(unittest.TestCase):
    def test_a_new_secret_key_goes_in_apikey_only_a_legacy_one_also_as_bearer(self):
        new = fetch_uploads.Api("https://x.supabase.co/", "sb_secret_abc123")
        self.assertEqual(new.headers, {"apikey": "sb_secret_abc123"})
        self.assertEqual(new.url, "https://x.supabase.co")
        legacy = fetch_uploads.Api("https://x.supabase.co", "eyJhbGciOiJIUzI1NiJ9.e30.sig")
        self.assertEqual(legacy.headers, {"apikey": "eyJhbGciOiJIUzI1NiJ9.e30.sig", "Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig"})


class FolderNames(unittest.TestCase):
    def test_the_desk_reads_semester_exam_and_year_from_the_folder(self):
        cases = [
            (upload(1), {"semester": 5, "kind": "end", "session": "2024-25"}),
            (upload(2, semester=1, exam_kind="mst1", session="2025-26", subject="Physics-II"), {"semester": 1, "kind": "mst1", "session": "2025-26"}),
            (upload(3, semester=1, exam_kind="mst2", session="2022-23", subject="Mathematics-I"), {"semester": 1, "kind": "mst2", "session": "2022-23"}),
            (upload(4, semester=3, exam_kind="mst3", subject="Data Structures 2"), {"semester": 3, "kind": "mst3", "session": "2024-25"}),
            (upload(5, semester=10, subject="Tourism Policy IV", session="2023-24"), {"semester": 10, "kind": "end", "session": "2023-24"}),
            (upload(6, semester=4, session=None, exam_month="2025-04"), {"semester": 4, "kind": "end", "session": None, "date": "2025"}),  # only a year: the desk never calls that sure
            (upload(7, semester=2, exam_kind="unknown", session=None), {"semester": 2, "kind": None, "session": None}),
        ]
        for row, want in cases:
            got = from_name((folder_for(row) / "01.jpg").as_posix())
            self.assertEqual({k: got[k] for k in want}, want, folder_for(row).as_posix())

    def test_a_folder_name_is_safe_on_windows_and_differs_per_upload(self):
        a = folder_for(upload(1, subject='C++ / "Data: Structures?" <II>...'))
        self.assertEqual(a.as_posix(), "mtech-aids-dual/Sem 5/End Sem 2024-25 C++ Data Structures II " + tag(upload(1)["id"]))
        self.assertNotEqual(folder_for(upload(1)), folder_for(upload(2)))
        self.assertRegex(tag("0123456789abcdef-ffff"), r"^[a-p]{8}$")  # no digit, no s or t: never read as a semester, a year or a test


class Fetch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.inbox = Path(self.tmp.name)
        self.rows = [
            upload(1),
            upload(2, status="held", message="Which year?", answer=None),
            upload(3, status="held", message="Which year?", answer="2023-24"),
            upload(4, status="published", pack_key="davv-sdsf/mtech-aids-dual-sem5"),
        ]
        self.api = FakeApi(self.rows, {f"{USER}/{r['id']}/{n}": f"{r['id']} {n}".encode() for r in self.rows for n in ("01.jpg", "02.jpg")})
        self.api.store[f"{USER}/{self.rows[0]['id']}/notes.txt"] = b"not a page"

    def test_fetch_takes_what_waits_and_writes_the_form_beside_the_pages(self):
        got = fetch(self.api, self.inbox, "2026-11-16")
        self.assertEqual([r["id"] for r, _ in got], [self.rows[0]["id"], self.rows[2]["id"]])  # pending, and held with an answer
        folder = got[0][1]
        self.assertEqual(folder, self.inbox / "uploads-2026-11-16" / folder_for(self.rows[0]))
        self.assertEqual(sorted(p.name for p in folder.iterdir()), ["01.jpg", "02.jpg", "upload.json"])  # notes.txt is not a page
        self.assertEqual((folder / "02.jpg").read_bytes(), f"{self.rows[0]['id']} 02.jpg".encode())
        saved = json.loads((folder / "upload.json").read_text(encoding="utf-8"))
        self.assertEqual((saved["subject"], saved["files"]), ("Software Engineering", ["01.jpg", "02.jpg"]))
        self.assertNotIn("uploader", saved)  # the account id stays in the database
        self.assertEqual(json.loads((got[1][1] / "upload.json").read_text(encoding="utf-8"))["answer"], "2023-24")

    def test_fetching_again_downloads_nothing(self):
        fetch(self.api, self.inbox, "2026-11-16")
        first = self.api.downloads
        fetch(self.api, self.inbox, "2026-11-16")
        self.assertEqual((first, self.api.downloads), (4, 4))

    def test_published_and_rejected_delete_the_photos_held_keeps_them(self):
        a, b, c = self.rows[0], self.rows[1], self.rows[2]
        self.assertEqual(mark(self.api, a, "published", "davv-sdsf/mtech-aids-dual-sem5", "davv-sdsf/mtech-aids-dual-sem5")["pack_key"], "davv-sdsf/mtech-aids-dual-sem5")
        self.assertEqual(mark(self.api, b, "rejected", "an answer sheet")["message"], "an answer sheet")
        held = mark(self.api, c, "held", "Which test: 1 or 2?")
        self.assertEqual((held["status"], held["message"], held["answer"]), ("held", "Which test: 1 or 2?", None))  # the old answer is cleared
        left = {p.split("/")[1] for p in self.api.store}
        self.assertEqual(left, {c["id"], self.rows[3]["id"]})

    def test_tidy_empties_folders_nobody_will_look_at_again(self):
        self.api.store[f"{USER}/withdrawn-upload/01.jpg"] = b"x"  # its row was deleted by the uploader
        emptied = tidy(self.api)
        self.assertEqual(sorted(emptied), sorted([f"{USER}/{self.rows[3]['id']}", f"{USER}/withdrawn-upload"]))
        self.assertEqual({p.split("/")[1] for p in self.api.store}, {r["id"] for r in self.rows[:3]})

    def test_find_needs_one_match(self):
        self.assertEqual(fetch_uploads.find(self.api, "a3b0c9d1")["id"], self.rows[0]["id"])
        for bad in ("a3b0", "ffff", "a3b0'; drop"):
            with self.assertRaises(SystemExit):
                fetch_uploads.find(self.api, bad)


if __name__ == "__main__":
    unittest.main()
