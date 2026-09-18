import {useEffect, useState} from 'react';
import {Navigate, Route, Routes} from 'react-router-dom';
import {AppLayout} from './components/AppLayout';
import {ensureDefaultAdmin, getCurrentUser} from './services/authService';
import AllowanceImportPage from './pages/AllowanceImportPage';
import LoginPage from './pages/LoginPage';
import MovementImportPage from './pages/MovementImportPageV2';
import StockCountPage from './pages/StockCountPage';
import UserManagementPage from './pages/UserManagementPage';
import BackupPage from './pages/BackupPage';
import CountHistoryPage from './pages/CountHistoryPage';

function RequireAuth() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(!!getCurrentUser());

  useEffect(() => {
    const refresh = () => setSignedIn(!!getCurrentUser());
    void ensureDefaultAdmin().finally(() => {
      refresh();
      setReady(true);
    });
    window.addEventListener('audit-auth-changed', refresh);
    return () => window.removeEventListener('audit-auth-changed', refresh);
  }, []);

  if (!ready) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">กำลังเตรียมระบบผู้ใช้งาน...</div>;
  if (!signedIn) return <Navigate to="/login" replace/>;
  return <AppLayout/>;
}

export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage/>}/>
    <Route element={<RequireAuth/>}>
      <Route index element={<Navigate to="/movement" replace/>}/>
      <Route path="/allowance" element={<AllowanceImportPage/>}/>
      <Route path="/movement" element={<MovementImportPage/>}/>
      <Route path="/count" element={<StockCountPage/>}/>
      <Route path="/count-history" element={<CountHistoryPage/>}/>
      <Route path="/users" element={<UserManagementPage/>}/>
      <Route path="/backup" element={<BackupPage/>}/>
    </Route>
    <Route path="*" element={<Navigate to="/movement" replace/>}/>
  </Routes>;
}
