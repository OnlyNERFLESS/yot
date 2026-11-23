// Android's Back button. Each screen or dialog registers a handler that closes
// whatever it has open and returns true; the newest registration is asked
// first. When nobody handles it, the shell goes Home, then exits on a second
// press (App.tsx).
import { useEffect, useRef } from 'react';

type Handler = () => boolean;
const handlers: Handler[] = [];

/** Offer Back to open things, newest first. True when something closed. */
export function runBack(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i]()) return true;
  return false;
}

/** Register for the component's lifetime; the latest closure is always used. */
export function useBack(handler: Handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const h: Handler = () => ref.current();
    handlers.push(h);
    return () => {
      const i = handlers.lastIndexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    };
  }, []);
}
