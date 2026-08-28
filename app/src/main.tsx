import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { applyTheme, storedTheme } from './theme';

// The macOS window hides its title bar and lets the traffic lights float over
// our header, so the header needs an inset there and nowhere else. Windows
// keeps its own decorations and would show that inset as dead space.
if (/Mac/i.test(navigator.userAgent)) document.documentElement.classList.add('mac');

// Before first paint, so the window never shows a light frame for one frame on
// the way to a dark one.
applyTheme(storedTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
