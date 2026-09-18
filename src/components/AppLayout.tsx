import {ClipboardList, DatabaseBackup, FileSpreadsheet, LogOut, PackageCheck, ShieldCheck, Users} from 'lucide-react';
import {NavLink, Outlet, useNavigate} from 'react-router-dom';
import {branchListText, getCurrentUser, logout} from '../services/authService';

const baseLinks = [
  ['/allowance', 'ไฟล์ Allowance', FileSpreadsheet],
  ['/movement', 'ไฟล์รายการเคลื่อนไหว', ClipboardList],
  ['/count', 'นับสต็อก', PackageCheck]
] as const;

function useLinks() {
  const user = getCurrentUser();
  return user?.role === 'ADMIN'
    ? [...baseLinks, ['/users', 'ผู้ใช้งาน', Users] as const]
    : baseLinks;
}

export function DesktopSidebar() {
  const navigate = useNavigate();
  const user = getCurrentUser();
  const links = [...useLinks(), ['/backup', 'สำรองข้อมูล', DatabaseBackup] as const];

  const doLogout = () => {
    logout();
    navigate('/login', {replace: true});
  };

  return <aside className="hidden min-h-screen w-72 shrink-0 border-r border-rose-100 bg-white p-5 lg:block">
    <div className="mb-8 flex items-center gap-3 p-2">
      <span className="grid size-12 place-items-center rounded-2xl bg-rose-700 text-white"><ShieldCheck/></span>
      <div><b className="block text-lg">Audit Stock</b><span className="text-xs text-slate-500">COUNT CONTROL</span></div>
    </div>
    <nav className="space-y-2">{links.map(([to, label, Icon]) =>
      <NavLink key={to} to={to} className={({isActive}) => `nav-link ${isActive ? 'nav-active' : ''}`}><Icon size={21}/>{label}</NavLink>
    )}</nav>
    <div className="mt-10 rounded-2xl bg-rose-50 p-4 text-xs leading-5 text-rose-900">
      <b className="block text-sm">{user?.displayName || user?.username}</b>
      <span className="block">สิทธิ์: {user?.role}</span>
      <span className="block">สาขา: {branchListText(user)}</span>
      <button className="mt-3 flex items-center gap-2 font-bold text-rose-700" onClick={doLogout}><LogOut size={16}/>ออกจากระบบ</button>
    </div>
  </aside>;
}

export function MobileBottomNavigation() {
  const links = useLinks();
  return <nav className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-30 grid border-t border-rose-100 bg-white/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden" style={{gridTemplateColumns: `repeat(${links.length}, minmax(0, 1fr))`}}>
    {links.map(([to, label, Icon]) =>
      <NavLink key={to} to={to} className={({isActive}) => `flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-bold ${isActive ? 'bg-rose-50 text-rose-700' : 'text-slate-500'}`}><Icon size={21}/>{label}</NavLink>
    )}
  </nav>;
}

export function AppLayout() {
  return <div className="min-h-screen lg:flex"><DesktopSidebar/><main className="app-main min-w-0 flex-1 pb-24 lg:pb-0"><Outlet/></main><MobileBottomNavigation/></div>;
}
