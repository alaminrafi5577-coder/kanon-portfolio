/* Site settings. Fill in the two Supabase values after creating the project (see SETUP.md).
   Both values are public by design (they only identify your project).
   Who can change the site is decided by the SQL policies in supabase-setup.sql + the admin email. */
window.SITE_CONFIG = {
  supabase: {
    url: "",      // e.g. https://abcdxyz.supabase.co
    anonKey: ""   // the "anon" / "publishable" key
  },
  // Admin email (the user you create in Supabase Authentication). Must match supabase-setup.sql.
  adminEmails: ["ahmedkanon1994@gmail.com"]
};
