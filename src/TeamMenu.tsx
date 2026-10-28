import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, CircleHelp, Settings2 } from 'lucide-react';
import './TeamMenu.css';

export default function TeamMenu({ configured, onSettings, onHelp }: {
  configured: boolean;
  onSettings: () => void;
  onHelp: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<'first' | 'last'>('first');
  const menuId = useId();
  const triggerId = useId();

  useLayoutEffect(() => {
    if (!open) return;
    function placeMenu() {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      if (anchor.right <= 0 || anchor.bottom <= 0 || anchor.top >= window.innerHeight) {
        setOpen(false);
        return;
      }
      const width = Math.min(300, window.innerWidth - 24);
      const above = Math.max(0, anchor.top - 20);
      const below = Math.max(0, window.innerHeight - anchor.bottom - 20);
      const opensAbove = above >= 260 || above >= below;
      setPosition({
        left: Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12)),
        width,
        maxHeight: opensAbove ? above : below,
        ...(opensAbove ? { bottom: window.innerHeight - anchor.top + 8 } : { top: anchor.bottom + 8 }),
      });
    }
    function dismissOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    }
    function onScroll(event: Event) {
      if (!panel.current?.contains(event.target as Node)) placeMenu();
    }
    function onResize() { setOpen(false); }
    placeMenu();
    const items = panel.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items?.[initialFocus.current === 'last' ? items.length - 1 : 0]?.focus();
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  function closeAndFocus() {
    trigger.current?.focus();
    setOpen(false);
  }
  function choose(action: () => void) {
    // Dialogs restore focus to this persistent trigger, not a removed menu item.
    closeAndFocus();
    action();
  }
  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
    } else if (event.key === 'Tab') {
      // Let Tab continue through the page from the profile button.
      closeAndFocus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }
  }

  return <div className="team-profile">
    <button ref={trigger} id={triggerId} type="button" className={`team-profile-trigger ${open ? 'is-open' : ''}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => { initialFocus.current = 'first'; setOpen(!open); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first';
          setOpen(true);
        }
      }}>
      <span className="team-profile-avatar" aria-hidden="true">C<span /></span>
      <span className="team-profile-name"><strong>Castle team</strong><small>Shared workspace</small></span>
      <ChevronUp size={16} className="team-profile-chevron" aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={panel} id={menuId} role="menu" aria-labelledby={triggerId}
      className="team-menu" style={position} onKeyDown={handleKeys}
      onBlur={event => {
        const next = event.relatedTarget as Node | null;
        if (!event.currentTarget.contains(next) && !trigger.current?.contains(next)) setOpen(false);
      }}>
      <div className="team-menu-heading" role="presentation">
        <span className="team-menu-avatar" aria-hidden="true">C</span>
        <div><strong>Castle team</strong><span>Shared workspace</span></div>
      </div>
      <div className={`team-menu-status ${configured ? 'is-connected' : ''}`} role="presentation">
        <span aria-hidden="true" />{configured ? 'Google Sheets connected' : 'Preview workspace'}
      </div>
      <div className="team-menu-separator" role="separator" />
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(onHelp)}>
        <CircleHelp size={17} aria-hidden="true" /><span>How it works</span>
      </button>
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(onSettings)}>
        <Settings2 size={17} aria-hidden="true" /><span>User settings</span>
      </button>
    </div>, document.body)}
  </div>;
}
