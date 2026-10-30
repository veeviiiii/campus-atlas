import unittest

from pipeline.build_pack import about
from pipeline.pack import blind_spot, came_back, confidence, topic_marks

ORDER = {"mst1-2024-25": 0, "end-2024-25": 1, "mst1": 2, "mst2": 3, "end": 4}


class Scoring(unittest.TestCase):
    def test_came_back_needs_an_end_sem_after_an_earlier_paper(self):
        self.assertTrue(came_back({"mst1", "end"}, ORDER))
        self.assertTrue(came_back({"end-2024-25", "end"}, ORDER))  # any earlier year counts
        self.assertFalse(came_back({"end"}, ORDER))
        self.assertFalse(came_back({"mst1", "mst2"}, ORDER))

    def test_blind_spot_is_end_sem_only_in_every_year(self):
        self.assertTrue(blind_spot({"end", "end-2024-25"}))
        self.assertFalse(blind_spot({"end", "mst1-2024-25"}))
        self.assertFalse(blind_spot({"mst2"}))

    def test_parts_of_one_printed_question_share_its_marks(self):
        a = {"id": "x-end-q3", "exam": "end", "page_ref": "p.pdf#p2", "label": "3(a)", "marks": 10}
        b = {**a, "id": "x-end-q4", "label": "3(b)"}
        c = {**a, "id": "x-end-q5", "label": "4", "marks": 2.5}
        self.assertEqual(topic_marks([a, b]), 10)
        self.assertEqual(topic_marks([a, c]), 12.5)
        self.assertEqual(topic_marks([{**a, "marks": None}]), 0)

    def test_confidence_drops_with_each_check_it_needed(self):
        self.assertEqual(confidence({}), 0.9)
        self.assertEqual(confidence({"contamination_checked": True, "extract_retried": True}), 0.7)


class ReportItems(unittest.TestCase):
    def test_page_1_is_not_page_10(self):
        items = [{"page_ref": "e.pdf#p10"}, {"page_ref": "e.pdf#p1"}, {"page_ref": "e.pdf#p9, e.pdf#p10"}]
        self.assertEqual(about(items, {"e.pdf#p1"}), [{"page_ref": "e.pdf#p1"}])
        self.assertEqual(len(about(items, {"e.pdf#p9", "e.pdf#p10"})), 2)


if __name__ == "__main__":
    unittest.main()
