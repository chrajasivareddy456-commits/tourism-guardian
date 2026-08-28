import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../store";

export default function Profile() {
  const navigate = useNavigate();
  const user = useAuth(s => s.user);
  const language = useAuth(s => s.language);
  const [form, setForm] = useState({ name: user?.name || "", email: user?.email || "", contactName: "", contactPhone: "" });
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.get("/auth/me").then(r => {
      const u = r.data;
      setForm({ name: u.name || "", email: u.email || "", contactName: u.trustedContact?.name || "", contactPhone: u.trustedContact?.phone || "" });
      localStorage.setItem("tg_user", JSON.stringify(u));
    }).catch(() => {
      const u:any = JSON.parse(localStorage.getItem("tg_user") || "null");
      if (u?.trustedContact) setForm(f => ({...f, contactName:u.trustedContact.name || "", contactPhone:u.trustedContact.phone || ""}));
    });
  }, []);

  async function save(e:any) {
    e.preventDefault();
    try {
      const r = await api.patch("/auth/me", { name: form.name, trustedContact: { name: form.contactName, phone: form.contactPhone } });
      useAuth.setState({ user: r.data });
      localStorage.setItem("tg_user", JSON.stringify(r.data));
      setMessage("Profile and emergency contact saved.");
    } catch { setMessage("Could not save while offline. Please try again when online."); }
  }

  return <div className="app">
    <header><div><b>🛡️ Tourism Guardian</b><small>Profile & emergency contact</small></div><button onClick={() => navigate("/")}>← Home</button></header>
    <main>
      <section className="card profile-card">
        <h1>👤 Profile</h1>
        <form onSubmit={save} className="profile-form">
          <label>Name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
          <label>Email<input value={form.email} disabled/></label>
          <h2>🚨 Emergency Contact</h2>
          <p className="muted">This contact is offered for quick calling after SOS.</p>
          <label>Contact name<input value={form.contactName} placeholder="e.g. Mother" onChange={e=>setForm({...form,contactName:e.target.value})}/></label>
          <label>Contact phone<input type="tel" value={form.contactPhone} placeholder="+91..." onChange={e=>setForm({...form,contactPhone:e.target.value})}/></label>
          {message && <p className="muted">{message}</p>}
          <button className="primary">Save details</button>
        </form>
      </section>
    </main>
  </div>
}
