# Real2Sem2Real — project page

Anonymous project page for **Real2Sem2Real: 3D Semantic Augmentations for Robot Learning
from a Single Human RGB Demonstration**. Served by GitHub Pages at
https://real2sem2real.github.io, deployed by `.github/workflows/static.yml` on every push to `main`.

The layout follows the VisTacAlign page (https://vis-tac-align.github.io) so the two read as siblings.

- `index.html` — the whole site (single file, no build step; only the DM Sans web font is external)
- `static/images/` — figures exported from the paper, plus website-only supplementary figures
- `static/favicon.svg`

## Updating results

The two bar charts and the full results table are drawn from the `R` table in the script at the
bottom of `index.html` (successes / trials per robot, task and method; `null` = still running).
Copy the numbers from `results/results.csv` in the paper repo. The image charts
(`success_rates`, `diversity_source`, `data_scaling`) are rendered from the paper's
`figures/*.pdf`:

    gs -q -dNOPAUSE -dBATCH -sDEVICE=png16m -dTextAlphaBits=4 -dGraphicsAlphaBits=4 \
       -r480 -sOutputFile=static/images/NAME.png ../papers/semantics_paper_RAL/figures/NAME.pdf

(use `-r200` for full-width figures such as `pipeline`).

## Adding supplementary (website-only) figures

1. Put the image in `static/images/` (PNG or JPG, at most ~2000 px wide).
2. In `index.html`, copy the commented `SUPPLEMENTARY FIGURES` block above the Limitations section,
   add the nav link it mentions, and renumber the section eyebrows.
3. Short extras can instead go inside a `<details class="more">` panel next to the section they
   support, the way the grasp-recovery and camera-alignment figures do.

Keep the whole page under ~25 MB.

## Anonymity

This page must stay free of author names, institutions, lab names, funding acknowledgements and
links to personal or lab pages while the paper is under review.
