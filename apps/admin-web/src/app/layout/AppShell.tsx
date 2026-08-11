import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, Command, LogOut, Menu, Search, ShieldCheck, X } from 'lucide-react';
import { sections } from '@/app/config/sections';
import { useAuth } from '@/features/auth/auth-context';

export function AppShell() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches);
  const preferenceKey = `orderak:admin-sidebar:${auth.admin?.id ?? 'unknown'}`;
  const [desktopHidden, setDesktopHidden] = useState(() => {
    if (typeof window === 'undefined' || !auth.admin) return false;
    return window.localStorage.getItem(`orderak:admin-sidebar:${auth.admin.id}`) === 'hidden';
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const current = sections.find(section => section.path === location.pathname || (section.path !== '/' && location.pathname.startsWith(section.path)));
  const visible = useMemo(() => sections.filter(section => auth.can(section.permission)), [auth]);
  const groups = useMemo(() => Array.from(new Set(visible.map(section => section.group))), [visible]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen(value => !value); }
      if (event.key === 'Escape') { setPaletteOpen(false); setMobileOpen(false); }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);

  useEffect(() => {
    setDesktopHidden(window.localStorage.getItem(preferenceKey) === 'hidden');
  }, [preferenceKey]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 860px)');
    const update = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(event.matches);
      if (!event.matches) setMobileOpen(false);
    };
    update(media);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const toggleNavigation = () => {
    if (isMobile) {
      setMobileOpen(true);
      return;
    }
    setDesktopHidden(current => {
      const next = !current;
      window.localStorage.setItem(preferenceKey, next ? 'hidden' : 'visible');
      return next;
    });
  };
  const navigationExpanded = isMobile ? mobileOpen : !desktopHidden;
  const navigationLabel = isMobile ? 'Open navigation' : desktopHidden ? 'Show navigation' : 'Hide navigation';

  return <div className={`app-shell ${desktopHidden ? 'navigation-hidden' : ''}`}>
    {mobileOpen && <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside id="admin-navigation" className={`sidebar ${mobileOpen ? 'open' : ''}`} aria-hidden={isMobile ? !mobileOpen : desktopHidden} inert={(isMobile ? !mobileOpen : desktopHidden) || undefined}>
      <div className="brand"><div className="brand-mark">O</div><div><strong>Orderak</strong><span>Control Center</span></div><button className="mobile-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18} /></button></div>
      <button className="command-trigger" onClick={() => setPaletteOpen(true)}><Search size={15} /><span>Find a section</span><kbd>Ctrl K</kbd></button>
      <nav>{groups.map(group => <div className="nav-group" key={group}><p>{group}</p>{visible.filter(section => section.group === group).map(section => { const Icon = section.icon; return <NavLink key={section.id} to={section.path} end={section.path === '/'} onClick={() => setMobileOpen(false)}><Icon size={17} /><span>{section.label}</span></NavLink>; })}</div>)}</nav>
      <div className="sidebar-user"><div className="avatar">{auth.admin?.name?.[0] || auth.admin?.email[0].toUpperCase()}</div><div><strong>{auth.admin?.name || 'Administrator'}</strong><span>{auth.admin?.role}</span></div><button aria-label="Sign out" onClick={auth.logout}><LogOut size={17} /></button></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><button className="menu-button" aria-controls="admin-navigation" aria-expanded={navigationExpanded} aria-label={navigationLabel} onClick={toggleNavigation}><Menu size={19} /></button><div className="breadcrumb"><Link to="/">Admin</Link><span>/</span><strong>{current?.label || 'Control Center'}</strong></div><div className="topbar-actions"><span className="secure-label"><ShieldCheck size={15} /> Secure session</span><button className="icon-button" aria-label="Security alerts" onClick={() => navigate('/system/security')}><Bell size={18} /></button><button className="profile-button" onClick={() => navigate('/system/security')}><span>{auth.admin?.email}</span><ChevronDown size={14} /></button></div></header>
      <main className="page"><Outlet /></main>
    </div>
    {paletteOpen && <CommandPalette sections={visible} close={() => setPaletteOpen(false)} navigate={path => { navigate(path); setPaletteOpen(false); }} />}
  </div>;
}

function CommandPalette({ sections: visible, close, navigate }: { sections: typeof sections; close: () => void; navigate: (path: string) => void }) {
  const [query, setQuery] = useState('');
  const matches = visible.filter(section => `${section.label} ${section.description} ${section.group}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="palette-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) close(); }}><section className="palette" role="dialog" aria-label="Command search"><header><Command size={18} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search stores, settings, support, security…" /><kbd>Esc</kbd></header><div>{matches.map(section => { const Icon = section.icon; return <button key={section.id} onClick={() => navigate(section.path)}><Icon size={17} /><span><strong>{section.label}</strong><small>{section.description}</small></span><em>{section.group}</em></button>; })}{!matches.length && <p className="empty-state">No matching section</p>}</div></section></div>;
}
