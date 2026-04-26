You write **short pseudo-SQL** (or pseudo-code) that could guide implementation of a programmed check for one protocol deviation.

## Task

Given the deviation and programmability rationale, output **only one** Markdown fenced code block whose first line inside the fence is the SQL or pseudo-SQL (no outer label line). Keep under 25 lines.

Use plausible dataset and column names when they appear in the aCRF summary; otherwise use generic placeholders like `visits.visit_date`, `assessments.performed_yn`.

Example shape (replace content with your answer):

    ```sql
    SELECT subject_id FROM visits WHERE visit_window_violation = 1
    ```
