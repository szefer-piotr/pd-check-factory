from __future__ import annotations

import unittest

from pdcheck_factory.pd_taxonomy import (
    all_sub_category_options,
    category_options,
    load_taxonomy,
    normalize_category_pair,
    validate_sub_category,
)


class PdTaxonomyTests(unittest.TestCase):
    def test_load_taxonomy_has_ten_categories(self) -> None:
        taxonomy = load_taxonomy()
        self.assertEqual(len(taxonomy), 10)
        self.assertIn("Study Visit Related", taxonomy)

    def test_validate_sub_category(self) -> None:
        self.assertTrue(
            validate_sub_category("Study Visit Related", "Study Visit Out of Window")
        )
        self.assertFalse(validate_sub_category("Study Visit Related", "Other"))

    def test_normalize_invalid_pair_blanks(self) -> None:
        cat, sub = normalize_category_pair("Study Visit Related", "Not A Real Subcategory")
        self.assertEqual(cat, "")
        self.assertEqual(sub, "")

    def test_all_sub_category_count(self) -> None:
        self.assertEqual(len(all_sub_category_options()), 32)
        self.assertEqual(len(category_options()), 10)


if __name__ == "__main__":
    unittest.main()
