/* Site settings. Fill these in after creating the Firebase project (see SETUP.md).
   The Firebase web config below is NOT a secret: it only identifies your project.
   Who can change the site is decided by firestore.rules + the admin email list. */
window.SITE_CONFIG = {
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: ""
  },
  // Google accounts allowed to edit the site. Must match the list inside firestore.rules.
  adminEmails: ["YOUR_ADMIN_EMAIL@gmail.com"]
};
