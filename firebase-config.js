/* ============================================================
   FIREBASE CONFIG  — paste YOUR values here (see README.md, Step 2)
   Firebase Console -> Project settings -> Your apps -> Web app -> "firebaseConfig"
   These values are NOT secret; your data is protected by the login +
   the Firestore security rules (firestore.rules).
   ============================================================ */
window.FIREBASE_CONFIG = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyDPXjnJbewBP4rsNrlokfn23NxwF92vwVE",
    authDomain: "raza-petroleum.firebaseapp.com",
    projectId: "raza-petroleum",
    storageBucket: "raza-petroleum.firebasestorage.app",
    messagingSenderId: "609792989983",
    appId: "1:609792989983:web:53d1a3c1eefeae3b52ee2a",
    measurementId: "G-QLYLZPFRGY"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>
};
