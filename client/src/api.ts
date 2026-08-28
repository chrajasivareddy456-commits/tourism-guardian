import axios from "axios";
import { useAuth } from "./store";

export const api = axios.create({
  baseURL: "https://tourism-guardian-backend.onrender.com/api",
});

api.interceptors.request.use(config => {
  const token = useAuth.getState().token;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});