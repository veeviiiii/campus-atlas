// The site's only link to a backend, used by one page: /upload/ (sign-in, the upload form, "My
// uploads"). Papers never come from here: they are read from the packs at build time, so every other
// page works with this service down, paused or not set up at all.
//
// The two variables are public by design (they are in the page's JavaScript): the publishable key can
// do only what the database's access rules allow a visitor or a signed-in student to do
// (supabase/migrations/0001_uploads.sql). The service key is never used by the website.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** False until both variables are set (web/.env.local, and the Vercel project): /upload/ then points to the Google Form. */
export const uploadsConfigured = Boolean(URL && KEY);

export const BUCKET = "paper-uploads";

let client: SupabaseClient | null = null;

/** The browser's client, made on first use; null when uploads are not set up. */
export function supabase(): SupabaseClient | null {
  if (!URL || !KEY) return null;
  client ??= createClient(URL, KEY, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });
  return client;
}
