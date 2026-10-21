import type { Metadata } from "next";

import { BackBar, REPO_URL, SiteFooter, SiteNav } from "@/components/Chrome";
import { SEND_PAPERS_FORM } from "@/lib/site";

export const metadata: Metadata = {
  title: "Send us your papers · Campus Atlas",
  description: "Photograph past exam papers from any DAVV course and send them in. We read them, check them and publish them for everyone.",
};

/** How students send in papers: one upload form, plus what to send and what happens next. */
export default function SendPage() {
  return (
    <>
      <SiteNav />
      <main className="page send">
        <BackBar href="/" label="Home" where="Send us your papers" />
        <h1 className="page-title">
          Send us your <em>papers</em>
        </h1>
        <p className="lead">
          Have past papers from any DAVV course? Photograph them and send them in. We read them, check them and add them here, free for
          everyone. Older years are especially welcome: they make Likely topics more reliable.
        </p>

        <div className="send-cta">
          {SEND_PAPERS_FORM ? (
            <>
              <a className="pill lime" href={SEND_PAPERS_FORM} target="_blank" rel="noreferrer">
                Upload photos ↗
              </a>
              <span className="note">
                Opens a Google Form. Google asks you to sign in to upload files, so we see your account name. We never publish it.
              </span>
            </>
          ) : (
            <span className="note">The upload form opens soon.</span>
          )}
        </div>

        <div className="send-grid">
          <section className="q">
            <h2>What to send</h2>
            <ul>
              <li>Any MST-1, MST-2 or End Sem question paper, from any year and any department.</li>
              <li>Every page of the paper. One paper per upload.</li>
              <li>On the form: department, course, semester, which exam, and the month and year it was held.</li>
            </ul>
          </section>
          <section className="q">
            <h2>Good photos</h2>
            <ul>
              <li>Flat, in good light, the whole page in the frame.</li>
              <li>Upright if you can (we can turn it, but it helps).</li>
              <li>One page per photo, nothing from other papers in the background.</li>
            </ul>
          </section>
          <section className="q">
            <h2>Privacy</h2>
            <ul>
              <li>Question papers only. No answer sheets, marks or result lists.</li>
              <li>Cover or crop out names, roll numbers and signatures before you upload.</li>
              <li>Every page we publish is shown as a photo, so check it is something you are happy to share.</li>
            </ul>
          </section>
          <section className="q">
            <h2>What happens next</h2>
            <ul>
              <li>An open AI model reads every question; our pipeline checks it and drops anything that isn&apos;t from that paper.</li>
              <li>We look it over and publish it with a photo of every page. It can take a few days.</li>
            </ul>
          </section>
        </div>

        <p className="note">
          Comfortable with code? You can add a whole course yourself with our open pyq-atlas skill:{" "}
          <a href={`${REPO_URL}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer">
            see CONTRIBUTING ↗
          </a>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
