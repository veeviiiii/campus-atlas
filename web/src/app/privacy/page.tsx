import type { Metadata } from "next";
import Link from "next/link";

import { BackBar, BottomBar, SiteNav } from "@/components/Chrome";
import { REPO_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy · Campus Atlas",
  description: "What Campus Atlas collects, why, where it is kept and how to have it deleted.",
  alternates: { canonical: "/privacy/" },
};

const UPDATED = "24 November 2026";

/**
 * /privacy/: what the site collects, in plain words. Every line describes what the code does
 * (components/SiteAnalytics.tsx, lib/analytics.ts, lib/supabase.ts, supabase/migrations/,
 * pipeline/fetch_uploads.py); change it here when they change. Google's sign-in screen links to it.
 */
export default function PrivacyPage() {
  return (
    <>
      <SiteNav />
      <main className="page send">
        <BackBar href="/" label="Home" where="Privacy" />
        <h1 className="page-title">Privacy</h1>
        <p className="lead">
          Campus Atlas is a free, non-commercial site of past exam papers for DAVV students, made by students. Reading papers needs no
          account. This page says what we collect, why, and how to have it deleted. Last updated {UPDATED}.
        </p>

        <div className="send-grid">
          <section className="q">
            <h2>Reading the site</h2>
            <ul>
              <li>No account, no cookies, no ads.</li>
              <li>
                Vercel, our host, counts page views with Vercel Web Analytics. It uses no cookies and recognises a returning visitor only
                within the same day. We see totals: which pages were opened, countries, phone or computer, and which site sent you. Never who
                you are.
              </li>
              <li>Before a view is counted, anything after # in the address is removed, and on the upload page the whole query.</li>
              <li>Like any web host, Vercel sees your IP address when it sends you a page.</li>
            </ul>
          </section>

          <section className="q">
            <h2>Signing in to upload a paper</h2>
            <ul>
              <li>
                Uploading on the site uses Sign in with Google, run by Supabase, the service that stores uploads. Google tells Supabase your
                email address, name and profile picture link. We ask for nothing else from your Google account.
              </li>
              <li>
                We use your email address only to know which uploads are yours, so you can see what became of them and answer a question we
                ask about one. We never publish it or share it.
              </li>
              <li>Your sign-in is kept in this browser&apos;s storage until you sign out.</li>
            </ul>
          </section>

          <section className="q">
            <h2>Your uploads</h2>
            <ul>
              <li>We keep what you type in the form (course, semester, subject, exam, year, your note) and the photos or PDFs you send.</li>
              <li>The photos are private: only you and the maintainer can open them.</li>
              <li>
                Before we publish a paper, we black out any names and roll numbers on it. Once a paper is published or turned down, its
                uploaded photos are deleted.
              </li>
              <li>You can withdraw an upload yourself while it is still waiting.</li>
            </ul>
          </section>

          <section className="q">
            <h2>The Google Form</h2>
            <ul>
              <li>
                If you send papers through our Google Form instead, Google asks you to sign in to upload files, so the form shows us your
                Google account name and email address. The files go to the maintainer&apos;s Google Drive. Google&apos;s own privacy policy
                covers the form.
              </li>
            </ul>
          </section>

          <section className="q">
            <h2>What we never do</h2>
            <ul>
              <li>Sell or share your information, show ads, or use it to track you across other sites.</li>
              <li>
                Campus Atlas&apos;s use of information received from Google APIs adheres to the{" "}
                <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
                  Google API Services User Data Policy ↗
                </a>
                , including the Limited Use requirements.
              </li>
            </ul>
          </section>

          <section className="q">
            <h2>Deleting your data</h2>
            <ul>
              <li>
                To have your account and everything you uploaded deleted, or to ask anything about this page,{" "}
                <a href={`${REPO_URL}/issues/new`} target="_blank" rel="noreferrer">
                  open an issue on our GitHub ↗
                </a>{" "}
                (don&apos;t post your email address there; we will reply and arrange it).
              </li>
              <li>
                The site is open source: <Link href="/send/">how papers come in</Link> and the code that handles uploads are public on{" "}
                <a href={REPO_URL} target="_blank" rel="noreferrer">
                  GitHub ↗
                </a>
                .
              </li>
            </ul>
          </section>
        </div>
      </main>
      <BottomBar />
    </>
  );
}
