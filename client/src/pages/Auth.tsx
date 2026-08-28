import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../store";
import { useNavigate } from "react-router-dom";

export default function Auth() {
  const [mode,setMode] = useState<"login"|"register">("register");
  const [form,setForm] = useState({name:"",email:"",password:"",role:"tourist",authorityCode:""});
  const [error,setError] = useState("");
  const setAuth = useAuth(s=>s.setAuth); const nav=useNavigate();

  async function submit(e:any) {
    e.preventDefault(); setError("");
    try {
      const r = await api.post(`/auth/${mode}`, form);
      setAuth(r.data.token,r.data.user);
      nav(r.data.user.role==="authority"?"/authority":"/");
    } catch(e:any) { setError(e.response?.data?.message || "Request failed"); }
  }

  return <div className="auth"><div className="card auth-card">
    <h1>🛡️ Tourism Guardian</h1><p>Explore Freely. Travel Safely.</p>
    <div className="tabs"><button onClick={()=>setMode("register")} className={mode==="register"?"active":""}>Register</button><button onClick={()=>setMode("login")} className={mode==="login"?"active":""}>Login</button></div>
    <form onSubmit={submit}>
      {mode==="register" && <input placeholder="Name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} />}
      <input placeholder="Email" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} />
      <input placeholder="Password (8+ characters)" type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} />
      {mode === "register" && (
  <>
    <select
      value={form.role}
      onChange={e => setForm({ ...form, role: e.target.value })}
    >
      <option value="tourist">Tourist</option>
      <option value="authority">Authority (requires invite code)</option>
    </select>

    {form.role === "authority" && (
      <input
        placeholder="Authority invite code"
        value={form.authorityCode}
        onChange={e =>
          setForm({ ...form, authorityCode: e.target.value })
        }
      />
    )}
  </>
)}
      {error && <div className="error">{error}</div>}
      <button className="primary">{mode==="register"?"Create account":"Login"}</button>
    </form>
    <small>Use real credentials. Authority registration requires a server-side invite code; authority sockets are RBAC protected.</small>
  </div></div>
}
