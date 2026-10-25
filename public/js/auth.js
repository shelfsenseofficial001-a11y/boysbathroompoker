// Login / registration screen.
import { api } from './api.js';
import { flagInvalid } from './invalid.js';
import { icons } from './svg/icons.js';

export function renderAuth(root, { onAuthed }) {
  let mode = 'login'; // or 'register'

  function draw() {
    const isLogin = mode === 'login';
    root.innerHTML = `<div class="screen"><div class="auth-wrap">
      <section class="panel auth-card">
        <div class="auth-brand">${icons.logo}</div>
        <h1 class="display">Boysbathroom Poker</h1>
        <p class="lead">Play-money Texas Hold’em for you and your friends.</p>
        <form id="auth-form" novalidate>
          <div class="field-row"><div class="field"><label for="username">Username</label><input id="username" type="text" autocomplete="username" required></div></div>
          <div class="field-row"><div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required></div></div>
          <p class="error-text" id="auth-error" role="alert"></p>
          <button type="submit" class="btn btn-primary btn-lg">${isLogin ? 'Log in' : 'Create account'}</button>
        </form>
        <div class="auth-switch">${isLogin ? 'New here?' : 'Already have an account?'} <button class="link" id="switch">${isLogin ? 'Create an account' : 'Log in'}</button></div>
        <p class="help-text" style="text-align:center">Sample accounts: alice, bob, carol — password poker123</p>
      </section>
    </div></div>`;

    root.querySelector('#switch').addEventListener('click', () => {
      mode = isLogin ? 'register' : 'login';
      draw();
    });

    root.querySelector('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameEl = root.querySelector('#username');
      const passEl = root.querySelector('#password');
      const username = nameEl.value.trim();
      const password = passEl.value;
      const errEl = root.querySelector('#auth-error');
      errEl.textContent = '';
      // The form is novalidate, so an empty box would otherwise submit and
      // come back with a complaint from the server about nothing in it.
      if (!username) {
        errEl.textContent = 'Enter your username.';
        return flagInvalid(nameEl, { focus: true });
      }
      if (!password) {
        errEl.textContent = 'Enter your password.';
        return flagInvalid(passEl, { focus: true });
      }
      try {
        onAuthed(isLogin ? await api.login(username, password) : await api.register(username, password));
      } catch (err) {
        errEl.textContent = err.message;
        // Which box is wrong isn't something the server will say - it
        // deliberately won't confirm whether a username exists - so both are
        // marked and the password is the one put back in focus.
        flagInvalid(nameEl);
        flagInvalid(passEl, { focus: true });
      }
    });
  }

  draw();
}
