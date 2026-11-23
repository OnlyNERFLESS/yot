import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/vazirmatn';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import App from './App';

// Android hands the status-bar and gesture-bar sizes over from MainActivity,
// because its WebView reports no safe-area insets; CSS reads --sat / --sab.
type Native = { YotInsets?: { top(): number; bottom(): number }; __yotInsets?: () => void };
const native = window as unknown as Native;
native.__yotInsets = () => {
  const n = native.YotInsets;
  if (!n) return;
  const st = document.documentElement.style;
  st.setProperty('--sat', `${n.top()}px`);
  st.setProperty('--sab', `${n.bottom()}px`);
};
native.__yotInsets();

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
