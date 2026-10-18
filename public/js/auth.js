// Login / registration screen.
import { api } from './api.js';
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
      const username = root.querySelector('#username').value.trim();
      const password = root.querySelector('#password').value;
      const errEl = root.querySelector('#auth-error');
      errEl.textContent = '';
      try {
        onAuthed(isLogin ? await api.login(username, password) : await api.register(username, password));
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  }

  draw();
}
