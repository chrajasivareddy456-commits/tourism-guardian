import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./store";
import Auth from "./pages/Auth";
import Home from "./pages/Home";
import Authority from "./pages/Authority";
import Profile from "./pages/Profile";

export default function App() {
  const user=useAuth(s=>s.user);
  return <Routes>
    <Route path="/auth" element={user?<Navigate to={user.role==="authority"?"/authority":"/"}/>:<Auth/>}/>
    <Route path="/" element={user&&user.role==="tourist"?<Home view="home"/>:<Navigate to="/auth"/>}/>
    <Route path="/destination" element={user&&user.role==="tourist"?<Home view="destination"/>:<Navigate to="/auth"/>}/>
    <Route path="/profile" element={user&&user.role==="tourist"?<Profile/>:<Navigate to="/auth"/>}/>
    <Route path="/authority" element={user?<Authority/>:<Navigate to="/auth"/>}/>
    <Route path="*" element={<Navigate to={user?(user.role==="authority"?"/authority":"/"):"/auth"}/>}/>
  </Routes>
}
