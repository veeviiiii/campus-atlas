# Demo script (3 minutes)

Every number below comes from `packs/davv-sdsf/mtech-aids-dual-sem1.json` and the eval. Nothing is
typed in by hand. The site needs no AI and no internet once loaded.

## Before you start

- Open the deployed site (or `cd web && npm run build`, then serve `web/out`) in a full-screen window
  at the projector's resolution, scrolled to the top. Checked at 1280x720, 1440x900, 1600x900 and
  1920x1080: once you enter the planet, the page scrolls itself so the globe and the side panel fit.
- If you rehearsed, open the planet and click **Clear progress** (in the buttons under the globe, shown
  once anything is studied) so all topics start dimmed again.
- Keep this page and the run report (`runs/sample/report.md`) open in another tab as backup.

## The 3 minutes

**0:00 (hero, then Earth view)**
> "Every university teaches the same subjects. No two ask the same questions."

The small planet on the right is already the real data (red squares are repeats). Click **Explore the
real planet**. On the Earth globe, click the lime pin at Indore (**School of Data Science & Forecasting,
DAVV**). The camera flies in and a card opens at the bottom of the globe: click
**M.Tech (Dual Degree) AI & DS · Semester 1 →**. The planet forms.

**0:25 (the planet)**
> "This is one semester of one course: 21 real exam papers. Subjects are continents, units are
> countries, topics are cities. Red rings mean a topic came back from a mid-sem test in the End Sem."

**0:40 (a repeat)** Click the **Physics-I** chip above the globe (the camera turns to Physics), click
the **Oscillations** country, then the red-ringed city **Damped Oscillations** (or press
*Exam tomorrow* and pick #3 from the list on the right). Its questions open in the panel on the right.
> "Asked in MST-2, then again in the End Sem, word for word."

Point at the two badges: *Came back in End Sem · word for word* and *Repeated from MST-2 · word for word*.
Click **view original page** to show the photo of the real paper.

**1:15 (a blind spot)** Back on Physics, hover a country with a **thick lavender border** (**Optics**
or **Lasers**); the tooltip says *Blind spot: never in the MSTs, asked in the End Sem*.
> "That border means a blind spot. The MSTs never asked about optics or lasers. Then 4 of the 7 End Sem
> Physics questions did." *(9 of the 15 End Sem Physics items are in these two units.)*

Optional: "In Statistics it's half the End Sem: correlation, regression and index numbers."

**1:45 (study mode)** On Damped Oscillations click **Mark as studied** (or **Quiz me** and get 2 of 3
right): its city goes from dimmed to full colour with a cyan burst, and the counter at the top right of
the globe moves to *1 / 95 explored*. Press **Exam tomorrow**: arcs connect the unexplored topics and
the panel lists them in order, repeats first, then blind spots, then marks.

**2:15 (how it works)** Scroll down to **How it works**: the four cards show 21 papers, 11 dropped,
18 of 19 and the pyq-atlas skill, all read from the pack.
> "The papers are phone photos. Gemma 4, an open-weight model, reads every page inside our Trust
> Harness: it checks each answer, drops fragments of other papers (11 of them), and anything it can't
> verify goes to an 'unsure' list instead of the map. Against 19 repeats we found by hand, it found 18.
> Any skills-compatible agent can add a new college with our open Agent Skill. Open source, Apache-2.0."

## If something goes wrong

- **Globe is blank or stuck:** reload. Everything is static, so the reload takes a second.
- **Can't find the red city:** use **Exam tomorrow** or **List view** and click the topic in the list.
- **Projector shows the page cut off:** zoom the browser out (Ctrl -), or click **Explore** in the top
  bar to jump back to the globe. The layout adapts.
- **Questions about accuracy:** every question links to its original photo; the run report lists every
  dropped fragment and every disagreement with the human manifest.
