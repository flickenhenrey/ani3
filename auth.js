/* =========================================================
   auth.js – Login / Register modal UI
   Injects the auth modal into the page and wires up buttons.
   Loaded on every page. Depends on firebase.js being loaded first.
   ========================================================= */

// ── Inject modal HTML ────────────────────────────────────
const modalHTML = `
<div id="auth-modal" class="auth-modal hidden">
  <div class="auth-box">
    <button id="auth-close" class="auth-close">✕</button>
    <h2 id="auth-title">Sign In</h2>

    <div id="auth-error" class="auth-error hidden"></div>

    <div class="auth-field">
      <label>Email</label>
      <input type="email" id="auth-email" placeholder="you@example.com" autocomplete="email" />
    </div>
    <div class="auth-field">
      <label>Password</label>
      <input type="password" id="auth-password" placeholder="Password" autocomplete="current-password" />
    </div>

    <button id="auth-submit" class="btn-auth-submit">Sign In</button>
    <button id="auth-google" class="btn-auth-google">Continue with Google</button>

    <p class="auth-switch">
      Don't have an account? <a id="auth-toggle" href="#">Register</a>
    </p>
  </div>
</div>`;

document.body.insertAdjacentHTML('beforeend', modalHTML);

// ── State ────────────────────────────────────────────────
let authMode = 'login'; // 'login' | 'register'

// ── DOM refs ─────────────────────────────────────────────
const modal      = document.getElementById('auth-modal');
const authTitle  = document.getElementById('auth-title');
const authSubmit = document.getElementById('auth-submit');
const authToggle = document.getElementById('auth-toggle');
const authError  = document.getElementById('auth-error');
const emailEl    = document.getElementById('auth-email');
const passEl     = document.getElementById('auth-password');

function showModal()  { modal.classList.remove('hidden'); emailEl.focus(); }
function hideModal()  { modal.classList.add('hidden'); clearError(); }
function showError(msg) { authError.textContent = msg; authError.classList.remove('hidden'); }
function clearError()   { authError.textContent = ''; authError.classList.add('hidden'); }

function setMode(mode) {
  authMode = mode;
  authTitle.textContent  = mode === 'login' ? 'Sign In' : 'Create Account';
  authSubmit.textContent = mode === 'login' ? 'Sign In' : 'Register';
  authToggle.textContent = mode === 'login' ? 'Register' : 'Sign In';
  document.querySelector('.auth-switch').firstChild.textContent =
    mode === 'login' ? "Don't have an account? " : "Already have an account? ";
  clearError();
}

// ── Submit ───────────────────────────────────────────────
authSubmit.addEventListener('click', async () => {
  const email = emailEl.value.trim();
  const pass  = passEl.value;
  if (!email || !pass) { showError('Please enter email and password.'); return; }
  authSubmit.disabled = true;
  authSubmit.textContent = 'Please wait…';
  clearError();
  try {
    if (authMode === 'login') {
      await window.fbAuth.login(email, pass);
    } else {
      await window.fbAuth.register(email, pass);
    }
    hideModal();
  } catch (e) {
    showError(friendlyError(e.code));
  } finally {
    authSubmit.disabled = false;
    setMode(authMode); // restore button text
  }
});

// ── Google ───────────────────────────────────────────────
document.getElementById('auth-google').addEventListener('click', async () => {
  clearError();
  try {
    await window.fbAuth.loginWithGoogle();
    hideModal();
  } catch (e) {
    showError(friendlyError(e.code));
  }
});

// ── Toggle mode ──────────────────────────────────────────
authToggle.addEventListener('click', e => {
  e.preventDefault();
  setMode(authMode === 'login' ? 'register' : 'login');
});

// ── Close ────────────────────────────────────────────────
document.getElementById('auth-close').addEventListener('click', hideModal);
modal.addEventListener('click', e => { if (e.target === modal) hideModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideModal(); });

// ── Auth state → update header button ────────────────────
window.fbAuth.onAuthChange(user => {
  updateAuthButton(user);
  // If a callback was registered (e.g. by app.js or player.js), call it
  if (typeof window.onUserReady === 'function') window.onUserReady(user);
});

function updateAuthButton(user) {
  let btn = document.getElementById('header-auth-btn');
  if (!btn) return;
  if (user) {
    btn.textContent = `Sign Out (${user.email?.split('@')[0] || 'User'})`;
    btn.onclick = async () => { await window.fbAuth.logout(); };
  } else {
    btn.textContent = 'Sign In';
    btn.onclick = showModal;
  }
}

// ── Friendly Firebase error messages ─────────────────────
function friendlyError(code) {
  const map = {
    'auth/invalid-email':          'Invalid email address.',
    'auth/user-not-found':         'No account found with that email.',
    'auth/wrong-password':         'Incorrect password.',
    'auth/email-already-in-use':   'An account already exists with this email.',
    'auth/weak-password':          'Password must be at least 6 characters.',
    'auth/too-many-requests':      'Too many attempts. Try again later.',
    'auth/popup-closed-by-user':   'Google sign-in was cancelled.',
    'auth/network-request-failed': 'Network error. Check your connection.',
  };
  return map[code] || `Error: ${code}`;
}

// Expose for other scripts to open the modal
window.showAuthModal = showModal;
