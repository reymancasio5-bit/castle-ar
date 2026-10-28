import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

export const EXIT_DURATION_MS = 180;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const ExitingContext = createContext(false);
type PresenceChildren = ReactNode | ((exiting: boolean) => ReactNode);

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const serverReducedMotion = () => false;

export function useExiting() {
  return useContext(ExitingContext);
}

/** Keep this boundary mounted while toggling `present`; children may be conditional. */
export function Presence({ present, children }: { present: boolean; children: PresenceChildren }) {
  const [retainedChildren, setRetainedChildren] = useState<PresenceChildren>(null);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, serverReducedMotion);

  // Cache only committed children, including a render function's last open closure.
  // Rendering always uses current props while open, so refs are ready immediately.
  useLayoutEffect(() => {
    if (present && children != null && typeof children !== 'boolean') {
      setRetainedChildren(() => children);
    }
  }, [present, children]);

  useLayoutEffect(() => {
    if (present || retainedChildren === null) return;
    if (reducedMotion) {
      setRetainedChildren(null);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(() => {
      if (active) setRetainedChildren(null);
    }, EXIT_DURATION_MS);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [present, reducedMotion, retainedChildren]);

  if (!present && (reducedMotion || retainedChildren === null)) return null;
  const content = present ? children : retainedChildren;
  return <ExitingContext.Provider value={!present}>
    {typeof content === 'function' ? content(!present) : content}
  </ExitingContext.Provider>;
}
