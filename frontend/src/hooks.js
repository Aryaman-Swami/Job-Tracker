import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// A dismissible overlay: focuses its first control on open, keeps Tab inside it,
// closes on Escape, and returns focus to whatever opened it.
export function useDialog(open, onClose) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const node = ref.current;
    const first = node?.querySelector('[data-autofocus]') || node?.querySelector(FOCUSABLE);
    (first || node)?.focus();

    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current?.(); return; }
      if (e.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    }
    document.addEventListener('keydown', onKey);
    document.body.classList.add('has-overlay');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('has-overlay');
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  return ref;
}

// FLIP: rows that stay in the list glide to their new place when a filter or sort
// reorders it; rows that are new to the view fade in. A pure "load more" append and
// the first load do not animate.
export function useFlip(containerRef, ids) {
  const prev = useRef(null);
  const key = ids.join(',');
  useLayoutEffect(() => {
    const box = containerRef.current;
    if (!box) return;
    const rows = [...box.querySelectorAll('[data-flip]')];
    const now = new Map(rows.map(el => [el.dataset.flip, el.getBoundingClientRect().top]));
    const before = prev.current;
    prev.current = now;
    if (!before || prefersReducedMotion()) return;
    const beforeIds = [...before.keys()];
    const isAppend = beforeIds.length <= ids.length && beforeIds.every((id, i) => ids[i] === id);
    if (isAppend) return;
    const timing = { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
    for (const el of rows) {
      const old = before.get(el.dataset.flip);
      if (old == null) { el.animate([{ opacity: 0 }, { opacity: 1 }], timing); continue; }
      const dy = old - now.get(el.dataset.flip);
      if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], timing);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// A shared indicator (nav pill, stage underline) that slides to the selected element.
export function useIndicator(containerRef, selector, dep) {
  const [style, setStyle] = useState(null);
  useLayoutEffect(() => {
    const box = containerRef.current;
    if (!box) return undefined;
    const measure = () => {
      const el = box.querySelector(selector);
      if (!el) { setStyle(null); return; }
      setStyle({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);
  return style;
}
