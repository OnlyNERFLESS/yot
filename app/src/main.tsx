import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/vazirmatn';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Hand over from the HTML splash once React has painted. A short floor keeps
// the logo from flashing for a single frame on a fast desktop start.
const splash = document.getElementById('splash');
if (splash) {
  const wait = Math.max(0, 650 - performance.now());
  window.setTimeout(() => {
    requestAnimationFrame(() => {
      splash.classList.add('out');
      window.setTimeout(() => splash.remove(), 400);
    });
  }, wait);
}
