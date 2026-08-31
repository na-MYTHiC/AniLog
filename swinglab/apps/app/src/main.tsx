import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support. Registration failure is not fatal — the app works fine
// without it, and a file:// load inside the desktop shell has no SW at all.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    // Relative to the deployed base, so this works at a GitHub Pages
    // subpath as well as at a domain root.
    const swUrl = new URL('sw.js', document.baseURI).href;
    navigator.serviceWorker.register(swUrl).catch(() => {});
  });
}
