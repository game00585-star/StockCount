import {type FormEvent, useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {ShieldCheck} from 'lucide-react';
import {DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_USERNAME, ensureDefaultAdmin, login} from '../services/authService';

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void ensureDefaultAdmin();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setLoading(true);
      await login(username, password);
      navigate('/movement', {replace: true});
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  return <main className="grid min-h-screen place-items-center bg-rose-50 p-4">
    <section className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-rose-700 text-white"><ShieldCheck/></span>
        <div>
          <h1 className="text-2xl font-black">Audit Stock Login</h1>
          <p className="text-sm text-slate-500">เข้าใช้งานตาม User และสาขาที่ได้รับสิทธิ์</p>
        </div>
      </div>

      <form className="grid gap-4" onSubmit={submit}>
        <label className="text-sm font-bold">User
          <input className="input mt-1" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" required/>
        </label>
        <label className="text-sm font-bold">Password
          <input className="input mt-1" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required/>
        </label>
        <button className="btn-primary" disabled={loading}>{loading ? 'กำลังเข้า...' : 'เข้าสู่ระบบ'}</button>
      </form>

      {message && <div className="notice mt-4">{message}</div>}
      <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-600">
        รหัสเริ่มต้น: <b>{DEFAULT_ADMIN_USERNAME}</b> / <b>{DEFAULT_ADMIN_PASSWORD}</b><br/>
        หลังเข้าแล้วให้ไปเมนู “ผู้ใช้งาน” เพื่อสร้าง User ของแต่ละสาขา
      </p>
    </section>
  </main>;
}
