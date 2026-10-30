"""The intake desk: a page on localhost that turns a senior's folder of phone photos and scans into the
per-semester PDFs and manifest.yaml entries the pipeline needs, then runs the pipeline.

    .venv/Scripts/python -m pipeline.desk "E:/uploads/M.Tech Int AIDS 5 year"   (or one PDF)

No server beyond this laptop, no sign-in. The model is called only when "Read pages" is pressed, and
what it reads is a suggestion the maintainer accepts or changes. Every decision is saved to
desk-decisions.json in the folder of sources. Walkthrough: ADDING-PAPERS.md.

    sources.py    list the PDFs and photos in a folder, render their pages
    geometry.py   turn, split and black out a page (the boxes are burned into the pixels)
    decisions.py  what the maintainer decided for every page, saved as JSON
    reader.py     read pages with the model, in the background
    suggest.py    turn readings into suggested fields (exam, subject, session, ...)
    dupes.py      pages that look the same as another page, by a picture fingerprint
    export.py     group pages into PDFs, merge them into each semester's manifest.yaml, run intake check
    server.py     the local web page and its small JSON API
"""
