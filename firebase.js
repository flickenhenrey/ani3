/* =========================================================
   firebase.js – Firebase setup, Auth, and Firestore helpers
   
   ⚠️  REPLACE the firebaseConfig object below with YOUR
       project's config from the Firebase Console.
       See README.md for step-by-step instructions.
   ========================================================= */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── YOUR FIREBASE CONFIG ──────────────────────────────────
// Replace this entire object with the one from Firebase Console
// (Project Settings → Your apps → SDK setup → Config)
const firebaseConfig = {
  apiKey:            "PASTE_YOUR_API_KEY_HERE",
  authDomain:        "PASTE_YOUR_AUTH_DOMAIN_HERE",
  projectId:         "PASTE_YOUR_PROJECT_ID_HERE",
  storageBucket:     "PASTE_YOUR_STORAGE_BUCKET_HERE",
  messagingSenderId: "PASTE_YOUR_MESSAGING_SENDER_ID_HERE",
  appId:             "PASTE_YOUR_APP_ID_HERE"
};
// ─────────────────────────────────────────────────────────

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Auth helpers ──────────────────────────────────────────

/** Returns the current signed-in user, or null */
function currentUser() { return auth.currentUser; }

/** Register with email + password */
async function register(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

/** Sign in with email + password */
async function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

/** Sign in with Google popup */
async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

/** Sign out */
async function logout() { return signOut(auth); }

/**
 * Subscribe to auth state changes
 * @param {function} callback – receives user object or null
 */
function onAuthChange(callback) { onAuthStateChanged(auth, callback); }

// ── Firestore path helpers ────────────────────────────────
// Data is stored per-user: users/{uid}/collection/docId

function userRef(uid)           { return doc(db, 'users', uid); }
function historyRef(uid, id)    { return doc(db, 'users', uid, 'history', String(id)); }
function favoritesRef(uid, id)  { return doc(db, 'users', uid, 'favorites', String(id)); }
function watchlistRef(uid, id)  { return doc(db, 'users', uid, 'watchlist', String(id)); }
function historyCol(uid)        { return collection(db, 'users', uid, 'history'); }
function favoritesCol(uid)      { return collection(db, 'users', uid, 'favorites'); }
function watchlistCol(uid)      { return collection(db, 'users', uid, 'watchlist'); }

// ── Watch Progress ────────────────────────────────────────

/**
 * Save watch progress for an anime.
 * Structure: { animeId, title, image, episode, currentTime, duration, updatedAt }
 */
async function saveProgress(data) {
  const uid = currentUser()?.uid;
  if (!uid) return;
  await setDoc(historyRef(uid, data.animeId), {
    ...data,
    updatedAt: serverTimestamp()
  });
}

/**
 * Get saved progress for a single anime
 * @param {string|number} animeId
 * @returns {object|null}
 */
async function getProgress(animeId) {
  const uid = currentUser()?.uid;
  if (!uid) return null;
  const snap = await getDoc(historyRef(uid, animeId));
  return snap.exists() ? snap.data() : null;
}

/**
 * Get last 30 watch history entries, sorted by most recent
 * @returns {Array}
 */
async function getWatchHistory() {
  const uid = currentUser()?.uid;
  if (!uid) return [];
  const q = query(historyCol(uid), orderBy('updatedAt', 'desc'), limit(30));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

// ── Favorites ─────────────────────────────────────────────

async function addFavorite(anime) {
  const uid = currentUser()?.uid;
  if (!uid) return;
  await setDoc(favoritesRef(uid, anime.id), {
    id: anime.id, title: anime.title, image: anime.image,
    addedAt: serverTimestamp()
  });
}

async function removeFavorite(animeId) {
  const uid = currentUser()?.uid;
  if (!uid) return;
  await deleteDoc(favoritesRef(uid, animeId));
}

async function isFavorite(animeId) {
  const uid = currentUser()?.uid;
  if (!uid) return false;
  const snap = await getDoc(favoritesRef(uid, animeId));
  return snap.exists();
}

async function getFavorites() {
  const uid = currentUser()?.uid;
  if (!uid) return [];
  const snap = await getDocs(query(favoritesCol(uid), orderBy('addedAt', 'desc')));
  return snap.docs.map(d => d.data());
}

// ── Watchlist ─────────────────────────────────────────────

async function addToWatchlist(anime) {
  const uid = currentUser()?.uid;
  if (!uid) return;
  await setDoc(watchlistRef(uid, anime.id), {
    id: anime.id, title: anime.title, image: anime.image,
    addedAt: serverTimestamp()
  });
}

async function removeFromWatchlist(animeId) {
  const uid = currentUser()?.uid;
  if (!uid) return;
  await deleteDoc(watchlistRef(uid, animeId));
}

async function isInWatchlist(animeId) {
  const uid = currentUser()?.uid;
  if (!uid) return false;
  const snap = await getDoc(watchlistRef(uid, animeId));
  return snap.exists();
}

async function getWatchlist() {
  const uid = currentUser()?.uid;
  if (!uid) return [];
  const snap = await getDocs(query(watchlistCol(uid), orderBy('addedAt', 'desc')));
  return snap.docs.map(d => d.data());
}

// ── Exports (used via window for non-module scripts) ──────
// We attach everything to window so regular <script> tags can access them.
window.fbAuth = {
  currentUser, register, login, loginWithGoogle, logout, onAuthChange
};
window.fbDB = {
  saveProgress, getProgress, getWatchHistory,
  addFavorite, removeFavorite, isFavorite, getFavorites,
  addToWatchlist, removeFromWatchlist, isInWatchlist, getWatchlist
};
