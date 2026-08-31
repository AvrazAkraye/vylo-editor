import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { applyTheme, storedTheme } from './theme';
import { applyDir, watchLang } from './rtl';
import { storedLang } from './i18n';

// The macOS window hides its title bar and lets the traffic lights float over
// our header, so the header needs an inset there and nowhere else. Windows
// keeps its own decorations and would show that inset as dead space.
if (/Mac/i.test(navigator.userAgent)) document.documentElement.classList.add('mac');

// Before first paint, so the window never shows a light frame for one frame on
// the way to a dark one.
applyTheme(storedTheme());

// The same reason, for the other axis: three of the four interface languages
// are right-to-left, and a frame of the whole layout mirrored the wrong way is
// far more visible than a frame of the wrong theme. `watchLang` then keeps `dir`
// derived from `lang` for the rest of the session, so whoever changes the
// language does not also have to remember the direction.
applyDir(storedLang());
watchLang();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
