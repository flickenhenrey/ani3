/* =========================================================
   firebase.js – Firebase setup, Auth, and Firestore helpers
   Project: anime67-2a3b7
   ========================================================= */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAnalytics }  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js';
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

// ── Your Firebase Config ──────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyAmfpWAmmbMRNbkmo0tpUBNaHa2aPPDTSY",
  authDomain:        "anime67-2a3b7.firebaseapp.com",
  databaseURL:       "https://anime67-2a3b7-default-rtdb.firebaseio.com",
  projectId:         "anime67-2a3b7",
  storageBucket:     "anime67-2a3b7.firebasestorage.app",
  messagingSenderId: "541162994426",
  appId:             "1:541162994426:web:135a4540fc2a08770fe743",
  measurementId:     "G-SQKTG2ZRD2"
};

// ── Initialize ────────────────────────────────────────────
const app       = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth      = getAuth(app);
const db        = getFirestore(app);

// ── Auth Helpers ──────────────────────────────────────────

/** Returns the currently signed-in user, or null */
function currentUser() {
  return auth.currentUser;
}

/** Register a new user with email + password */
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

/** Sign out the current user */
async function logout() {
  return signOut(auth);
}

/**
 * Listen for auth state changes (signed in / signed out)
 * @param {function} callback – receives user object or null
 */
function onAuthChange(callback) {
  onAuthStateChanged(auth, callback);
}

// ── Firestore Path Helpers ────────────────────────────────
// All user data lives under: users/{uid}/subcollection/{docId}

function historyRef(uid, animeId)   { return doc(db, 'users', uid, 'history',   String(animeId)); }
function favoritesRef(uid, animeId) { return doc(db, 'users', uid, 'favorites', String(animeId)); }
function watchlistRef(uid, animeId) { return doc(db, 'users', uid, 'watchlist', String(animeId)); }
function historyCol(uid)            { return collection(db, 'users', uid, 'history'); }
function favoritesCol(uid)          { return collection(db, 'users', uid, 'favorites'); }
function watchlistCol(uid)          { return collection(db, 'users', uid, 'watchlist'); }

// ── Watch Progress ────────────────────────────────────────

/**
 * Save watch progress for an anime to Firestore.
 * Called automatically every 5 seconds while video plays.
 * @param {{ animeId, title, image, episode, currentTime, duration }} data
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
 * Get the saved watch progress for a single anime.
 * Used on the watch page to resume playback.
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
 * Get the last 30 watched anime, sorted by most recently watched.
 * Used on the homepage for the "Continue Watching" section.
 * @returns {Array}
 */
async function getWatchHistory() {
  const uid = currentUser()?.uid;
  if (!uid) return [];
  const q    = query(historyCol(uid), orderBy('updatedAt', 'desc'), limit(30));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

// ── Favorites ─────────────────────────────────────────────

/** Add an anime to the user's favorites */
async function addFavorite(anime) {
  const uid = currentUser()?.uid;
  if (!uid) return;
  await setDoc(favoritesRef(uid, anime.id), {
    id:      anime.id,
    title:   anime.title,
    image:   anime.image,
    addedAt: serverTimestamp()
  });
}

/** Remove an anime from the user's favorites */
async function removeFavorite(animeId) {
  const uid = currentUser()?.uid;
  if (!uid) return;
  await deleteDoc(favoritesRef(uid, animeId));
}

/** Check if an anime is in the user's favorites */
async function isFavorite(animeId) {
  const uid = currentUser()?.uid;
  if (!uid) return false;
  const snap = await getDoc(favoritesRef(uid, animeId));
  return snap.exists();
}

/** Get all favorited anime, sorted by most recently added */
async function getFavorites() {
  const uid = currentUser()?.uid;
  if (!uid) return [];
  const snap = await getDocs(query(favoritesCol(uid), orderBy('addedAt', 'desc')));
  return snap.docs.map(d => d.data());
}

// ── Watchlist ─────────────────────────────────────────────

/** Add an anime to the user's watchlist */
async function addToWatchlist(anime) {
  const uid = currentUser()?.uid;
  if (!uid) return;
  await setDoc(watchlistRef(uid, anime.id), {
    id:      anime.id,
    title:   anime.title,
    image:   anime.image,
    addedAt: serverTimestamp()
  });
}

/** Remove an anime from the user's watchlist */
async function removeFromWatchlist(animeId) {
  const uid = currentUser()?.uid;
  if (!uid) return;
  await deleteDoc(watchlistRef(uid, animeId));
}

/** Check if an anime is in the user's watchlist */
async function isInWatchlist(animeId) {
  const uid = currentUser()?.uid;
  if (!uid) return false;
  const snap = await getDoc(watchlistRef(uid, animeId));
  return snap.exists();
}

/** Get all watchlisted anime, sorted by most recently added */
async function getWatchlist() {
  const uid = currentUser()?.uid;
  if (!uid) return [];
  const snap = await getDocs(query(watchlistCol(uid), orderBy('addedAt', 'desc')));
  return snap.docs.map(d => d.data());
}

// ── Expose to window (so non-module scripts can use these) ─
// auth.js, app.js, and player.js all access these via
// window.fbAuth.xxx and window.fbDB.xxx

window.fbAuth = {
  currentUser,
  register,
  login,
  loginWithGoogle,
  logout,
  onAuthChange
};

window.fbDB = {
  saveProgress,
  getProgress,
  getWatchHistory,
  addFavorite,
  removeFavorite,
  isFavorite,
  getFavorites,
  addToWatchlist,
  removeFromWatchlist,
  isInWatchlist,
  getWatchlist
};
