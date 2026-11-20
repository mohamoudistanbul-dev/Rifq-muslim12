import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './touch.css';
import { installTouchGuard } from './lib/touchGuard';

// A native shell does not offer the browser's long-press menu on its own
// controls. Installed once, before the first render.
installTouchGuard();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
