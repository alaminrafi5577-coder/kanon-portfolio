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
  // Admin email(s) allowed to edit the site (the account you create in Firebase Authentication).
  // Must match the list inside firestore.rules.
  adminEmails: ["ahmedkanon1994@gmail.com"]
};
