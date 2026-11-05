import { useCallback, useEffect, useState } from 'react';

const read = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

// Theme is set on <html data-theme> (initially by the inline script in index.html, so there is no flash).
export function useTheme() {
  const [theme, setTheme] = useState(read);

  // Keep every Sidebar instance (desktop + phone sheet) in sync.
  useEffect(() => {
    const onChange = () => setTheme(read());
    window.addEventListener('themechange', onChange);
    return () => window.removeEventListener('themechange', onChange);
  }, []);

  const toggle = useCallback(() => {
    const next = read() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* private mode */ }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#0e1116' : '#f2f4f7');
    window.dispatchEvent(new Event('themechange'));
  }, []);

  return [theme, toggle];
}
