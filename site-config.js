/* Site settings.
   Both Supabase values below are public by design (they only identify the project).
   Who can change the site is decided by the SQL policies in supabase-setup.sql + the admin email. */
window.SITE_CONFIG = {
  supabase: {
    url: "https://tromntklbkuysrrwwqgv.supabase.co",
    anonKey: "sb_publishable_KD4-nVBgMLwRZN9xC82Atw_ieCIziXU"
  },
  // Admin email (the user created in Supabase Authentication). Must match supabase-setup.sql.
  adminEmails: ["ahmedkanon1994@gmail.com"]
};
