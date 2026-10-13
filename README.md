# Raza Petroleum Services — Cloud ERP

Online version of your ERP. Static website (GitHub Pages) + Firebase (login + database).
Data is stored in the cloud, so you can use it from any phone/PC, and several users can log in.

```
index.html              page structure
style.css               styling
app.js                  the ERP itself (all screens & calculations)
cloud.js                login + cloud saving (Firebase)
firebase-config.js      YOUR Firebase keys  <-- you edit this
firestore.rules         security rules      <-- you paste into Firebase
```
All files sit together in ONE folder (no sub-folders).

Cost: GitHub Pages and Firebase's free "Spark" plan are enough for a single petrol station.

---

## Step 1 — Create the Firebase project (5 min)
1. Go to https://console.firebase.google.com → **Add project** → name it (e.g. `raza-erp`). Google Analytics: off.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**
3. **Authentication → Users → Add user**: create an email + password for each person who will use the ERP.
4. **Build → Firestore Database → Create database** → choose a location near you (e.g. `asia-south1` Mumbai) → **Production mode**.

## Step 2 — Connect the website to Firebase
1. Firebase **Project settings (gear) → General → Your apps → Web (`</>`)** → register app (no hosting).
2. Copy the `firebaseConfig` values into **firebase-config.js**.

## Step 3 — Put it on GitHub
1. Create a GitHub repository (e.g. `raza-erp`).
2. UNZIP first, then upload the files (not the .zip) — drag them all into the repo: Add file → Upload files → Commit.
3. Repo **Settings → Pages → Source: Deploy from a branch → `main` / root → Save.**
4. After ~1 minute your site is live at `https://YOUR-USERNAME.github.io/raza-erp/`.
5. Firebase **Authentication → Settings → Authorized domains → Add domain**: `YOUR-USERNAME.github.io`.

## Step 4 — Lock the database (IMPORTANT)
Firebase **Firestore → Rules** → paste the contents of **firestore.rules**, replace the example
emails with your users' emails → **Publish**. Without this, nobody (or everybody) can access the data.

## Step 5 — First run
1. Open your site and log in.
2. It says "Cloud database is empty" → click **Choose data .json file** → select
   `Raza-Petroleum-initial-data.json` (your current data, supplied separately).
3. Done. Every change now saves automatically (status pill top-right: "Saved to cloud").

---

## Good to know
* **Do not upload data .json files to GitHub** (a public repo is visible to everyone). The repo only holds code, no business data. `.gitignore` already blocks `*.json`.
* The Firebase keys in `firebase-config.js` are not secrets; the login + rules protect the data.
* **Backups:** use the 📤 button regularly to download a JSON backup. Also in Firebase you can schedule Firestore backups later (paid) — a monthly manual export is fine to start.
* **Two people at once:** changes appear live on the other device. If two people edit the *same* section (e.g. both add expenses) within a second or two, the last save wins — for busy multi-user use, tell me and I can upgrade to per-record saving.
* **No internet:** you will see a red "Not saved" pill; the data stays in the open tab and saves when you click it / when internet returns. Don't close the tab meanwhile.
* **Updating the software:** edit the files on GitHub; the site updates in a minute. Your data is untouched.
* **Add a user later:** Firebase Authentication → Add user, then add the email in firestore.rules → Publish.
