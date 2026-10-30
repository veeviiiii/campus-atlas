import unittest

from pipeline.manifest import check_exams, exam_kind, exam_order, match_exam, match_subject, normalize, papers, session_of, sessions


def manifest(exams=None, files=None):
    return {
        "exams": exams
        if exams is not None
        else [
            {"id": "mst1", "name": "MST-1", "date": "2025-10"},
            {"id": "end", "name": "End Sem", "date": "2026-01"},
        ],
        "subjects": [
            {"id": "physics-1", "name": "Physics-I", "aliases": ["Applied Physics"]},
            {"id": "fundamentals-of-programming", "name": "Fundamentals of Programming", "aliases": ["Fundamental Of Programming language"]},
        ],
        "files": files if files is not None else [{"file": "a.pdf", "exam": "mst1", "pages": []}, {"file": "b.pdf", "exam": "end", "pages": []}],
    }


class Sessions(unittest.TestCase):
    def test_session_starts_in_july(self):
        self.assertEqual(session_of("2025-10"), "2025-26")
        self.assertEqual(session_of("2026-01"), "2025-26")
        self.assertEqual(session_of("2025-06"), "2024-25")
        self.assertEqual(session_of("1999-07"), "1999-00")
        with self.assertRaises(ValueError):  # no month: the manifest must give the session
            session_of("2025")

    def test_exam_kind(self):
        self.assertEqual(exam_kind("mst1"), "mst1")
        self.assertEqual(exam_kind("end-2024-25"), "end")


class CheckExams(unittest.TestCase):
    def test_fills_in_the_session_from_the_date(self):
        m = manifest()
        check_exams(m)
        self.assertEqual([e["session"] for e in m["exams"]], ["2025-26", "2025-26"])

    def test_another_year_carries_its_session_in_the_id(self):
        m = manifest(exams=[{"id": "end", "name": "End Sem", "date": "2026-01"}, {"id": "end-2024-25", "name": "End Sem", "date": "2025-01"}])
        m["files"] = [{"file": "a.pdf", "exam": "end"}, {"file": "b.pdf", "exam": "end-2024-25"}]
        check_exams(m)
        self.assertEqual(sessions(m), ["2024-25", "2025-26"])
        self.assertEqual(sessions(m, {"end"}), ["2025-26"])

    def test_refuses_ids_the_pack_builder_would_misread(self):
        for bad in ("mst4", "end-2023-24", "final"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                check_exams(manifest(exams=[{"id": bad, "name": "x", "date": "2026-01"}], files=[]))

    def test_refuses_duplicates_and_unknown_exams(self):
        with self.assertRaises(ValueError):
            check_exams(manifest(exams=[{"id": "end", "name": "End Sem", "date": "2026-01"}] * 2, files=[]))
        with self.assertRaises(ValueError):
            check_exams(manifest(files=[{"file": "a.pdf", "exam": "end"}, {"file": "a.pdf", "exam": "mst1"}]))
        with self.assertRaises(ValueError):
            check_exams(manifest(files=[{"file": "a.pdf", "exam": "mst2"}]))

    def test_exam_order_by_month_then_kind(self):
        m = manifest(
            exams=[
                {"id": "end", "name": "End Sem", "date": "2025-12"},
                {"id": "mst2", "name": "MST-2", "date": "2025-12"},
                {"id": "end-2024-25", "name": "End Sem", "date": "2025-01"},
            ],
            files=[],
        )
        check_exams(m)
        self.assertEqual(exam_order(m), {"end-2024-25": 0, "mst2": 1, "end": 2})

    def test_a_year_without_its_month_needs_the_session_and_sorts_by_kind(self):
        with self.assertRaises(ValueError):
            check_exams(manifest(exams=[{"id": "mst1", "name": "MST-1", "date": "2025"}], files=[]))
        with self.assertRaises(ValueError):
            check_exams(manifest(exams=[{"id": "mst1", "name": "MST-1", "date": "Oct 2025", "session": "2025-26"}], files=[]))
        m = manifest(
            exams=[
                {"id": "end", "name": "End Sem", "date": "2025", "session": "2024-25"},
                {"id": "mst3", "name": "MST-3", "date": "2025", "session": "2024-25"},
                {"id": "mst1", "name": "MST-1", "date": "2025-02", "session": "2024-25"},
                {"id": "mst1-2023-24", "name": "MST-1", "date": "2024", "session": "2023-24"},
            ],
            files=[],
        )
        check_exams(m)
        self.assertEqual(exam_order(m), {"mst1-2023-24": 0, "mst1": 1, "mst3": 2, "end": 3})


class Papers(unittest.TestCase):
    def test_a_continued_page_joins_the_paper_before_it(self):
        m = manifest(
            files=[
                {
                    "file": "a.pdf",
                    "exam": "end",
                    "pages": [
                        {"page": 1, "subject": "physics-1"},
                        {"page": 2, "subject": "physics-1", "continues_previous": True},
                        {"page": 3, "subject": "physics-1"},
                    ],
                }
            ]
        )
        self.assertEqual([[p.page for p in paper.pages] for paper in papers(m)], [[1, 2], [3]])


class Matching(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(normalize("PHYSICS-I"), "physics 1")
        self.assertEqual(normalize("Data & Society"), "data and society")

    def test_subjects_match_by_name_and_alias_never_by_code(self):
        m = manifest()
        self.assertEqual(match_subject(m, "PHYSICS - I"), "physics-1")
        self.assertEqual(match_subject(m, "Applied physics"), "physics-1")
        self.assertEqual(match_subject(m, "B.Tech Fundamental Of Programming Language (CS101)"), "fundamentals-of-programming")
        self.assertIsNone(match_subject(m, "Environmental Science"))
        self.assertIsNone(match_subject(m, None))

    def test_exam_titles(self):
        self.assertEqual(match_exam("Mid Semester -1 Test"), "mst1")
        self.assertEqual(match_exam("TEST-II"), "mst2")
        self.assertEqual(match_exam("Internal Exam -III"), "mst3")
        self.assertEqual(match_exam("Second Mid-Term Exam"), "mst2")
        self.assertEqual(match_exam("First Class Test"), "mst1")
        self.assertEqual(match_exam("2nd Term exam"), "mst2")
        self.assertEqual(match_exam("3rd Semester Class Test 1"), "mst1")
        self.assertEqual(match_exam("End Semester Examination"), "end")
        self.assertIsNone(match_exam("Quiz"))


if __name__ == "__main__":
    unittest.main()
