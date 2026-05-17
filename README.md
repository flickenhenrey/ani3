# AniStream – Setup Guide

## Files
```
animestream/
├── index.html       Homepage
├── anime.html       Watch page
├── watchlist.html   Favorites + Watchlist
├── style.css        All styles
├── api.js           AniList + Consumet API calls
├── firebase.js      Firebase setup + all DB/Auth helpers  ← EDIT THIS
├── auth.js          Login/Register modal UI
├── app.js           Homepage logic
└── player.js        Watch page: player, episodes, progress
```

---

## Step 1 – Create a Firebase Project

1. Go to https://console.firebase.google.com
2. Click **"Add project"**
3. Name it anything (e.g. `anistream`)
4. Disable Google Analytics if you don't need it → click **Create project**

---

## Step 2 – Enable Authentication

1. In the Firebase Console sidebar, click **Build → Authentication**
2. Click **"Get started"**
3. Under **Sign-in method**, enable:
   - **Email/Password** → toggle on → Save
   - **Google** → toggle on → enter your support email → Save

---

## Step 3 – Create Firestore Database

1. In the sidebar click **Build → Firestore Database**
2. Click **"Create database"**
3. Choose **"Start in test mode"** (you can add security rules later)
4. Pick any region → click **Enable**

---

## Step 4 – Get Your Config Keys

1. In Firebase Console, click the **gear icon** (⚙️) → **Project settings**
2. Scroll down to **"Your apps"**
3. If no app exists: click the **`</>`** (Web) icon → register app (name anything) → click **Register app**
4. You'll see a block like this:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "yourapp.firebaseapp.com",
  projectId: "yourapp",
  storageBucket: "yourapp.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123:web:abc123"
};
```

5. Copy the **entire object**

---

## Step 5 – Paste Config Into firebase.js

Open `firebase.js` and replace the placeholder config at the top:

```js
// BEFORE (placeholder):
const firebaseConfig = {
  apiKey:            "PASTE_YOUR_API_KEY_HERE",
  authDomain:        "PASTE_YOUR_AUTH_DOMAIN_HERE",
  ...
};

// AFTER (your real values):
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "yourapp.firebaseapp.com",
  projectId: "yourapp",
  storageBucket: "yourapp.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123:web:abc123"
};
```

---

## Step 6 – Add Your GitHub Pages Domain to Firebase Auth

This prevents "unauthorized domain" errors when users try to sign in.

1. Firebase Console → **Authentication → Settings → Authorized domains**
2. Click **"Add domain"**
3. Enter your GitHub Pages domain, e.g.: `yourusername.github.io`
4. Click **Add**

---

## Step 7 – Deploy to GitHub Pages

1. Create a GitHub repo (e.g. `anistream`)
2. Upload all files to the repo root
3. Go to repo **Settings → Pages**
4. Under **Source**, select **"Deploy from a branch"**
5. Branch: `main`, folder: `/ (root)` → click **Save**
6. Your site will be live at: `https://yourusername.github.io/anistream/`

---

## Step 8 – Set Firestore Security Rules (Optional but recommended)

Once you're happy with the site, lock down Firestore so only authenticated users can read/write their own data.

In Firebase Console → **Firestore → Rules**, replace the default with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only read/write their own data
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Click **Publish**.

---

## How Firebase is used in AniStream

| Feature             | Firebase Service | Firestore path                          |
|---------------------|------------------|-----------------------------------------|
| User login/register | Authentication   | —                                       |
| Watch progress      | Firestore        | `users/{uid}/history/{animeId}`         |
| Favorites           | Firestore        | `users/{uid}/favorites/{animeId}`       |
| Watchlist           | Firestore        | `users/{uid}/watchlist/{animeId}`       |

Progress is saved automatically every 5 seconds while a video is playing.
If a user is not signed in, the Favorite/Watchlist buttons open the login modal.

---

## Running locally for testing

```bash
npx serve .
# or
python -m http.server 8080
```

Open http://localhost:8080 — Firebase Auth works on localhost by default.
