import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { api } from './api.js';
import './app.css';
import './styles.css';

async function start() {
  // Dev-only sample data (?fixture). The DEV guard is a build-time constant, so the
  // production bundle never contains the fixture or the mock API.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('fixture')) {
    const { installFixture } = await import('./dev/mockApi.js');
    installFixture(api);
    document.documentElement.dataset.fixture = 'true';
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
start();

if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
