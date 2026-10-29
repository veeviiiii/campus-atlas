import unittest

from pipeline.validate import Orientation, Question, ask, parse_json, validate_items


def item(**kw):
    return {"text": "Explain the working of a He-Ne laser.", "marks": 10, "position_on_page": "top", **kw}


class FakeProvider:
    """Replies from a list, in order; a RuntimeError in the list is raised (model unreachable)."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.prompts = []

    def generate(self, prompt, images=None, step=""):
        self.prompts.append(prompt)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


class ParseJson(unittest.TestCase):
    def test_fences_and_stray_prose(self):
        self.assertEqual(parse_json('```json\n{"a": 1}\n```'), {"a": 1})
        self.assertEqual(parse_json('Here you go: {"a": 1} hope it helps'), {"a": 1})
        with self.assertRaises(ValueError):
            parse_json("no json here")


class ValidateItems(unittest.TestCase):
    def test_keeps_good_questions_and_says_why_others_fail(self):
        good, bad = validate_items(
            [item(), item(text="Too sh"), item(marks=50), item(page=3), {"text": "Missing where it sits on the page"}],
            max_marks=20,
            n_pages=2,
        )
        self.assertEqual(len(good), 1)
        self.assertIsInstance(good[0], Question)
        reasons = [why for _, why in bad]
        self.assertEqual(len(bad), 4)  # nothing silently dropped
        self.assertIn("text too short", reasons[0])
        self.assertIn("not plausible", reasons[1])
        self.assertIn("outside 1..2", reasons[2])
        self.assertIn("position_on_page", reasons[3])


class Ask(unittest.TestCase):
    def test_valid_first_time(self):
        value, err, retried = ask(FakeProvider('{"rotation": 180}'), "p", [], Orientation, "orient")
        self.assertEqual((value.rotation, err, retried), (180, None, False))

    def test_retries_once_with_the_error(self):
        provider = FakeProvider('{"rotation": 45}', '{"rotation": 90}')
        value, err, retried = ask(provider, "p", [], Orientation, "orient")
        self.assertEqual((value.rotation, err, retried), (90, None, True))
        self.assertIn("not valid", provider.prompts[1])

    def test_still_invalid_goes_back_with_the_error(self):
        value, err, retried = ask(FakeProvider("nope", "still nope"), "p", [], Orientation, "orient")
        self.assertIsNone(value)
        self.assertTrue(err)
        self.assertTrue(retried)

    def test_model_unreachable(self):
        value, err, retried = ask(FakeProvider(RuntimeError("503 after 5 tries")), "p", [], Orientation, "orient")
        self.assertEqual((value, retried), (None, False))
        self.assertIn("503", err)


if __name__ == "__main__":
    unittest.main()
