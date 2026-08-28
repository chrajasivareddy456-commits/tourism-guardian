import axios from "axios";
import { useAuth } from "./store";

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL || "";

const baseURL = configuredBaseUrl.endsWith("/api")
  ? configuredBaseUrl
  : `${configuredBaseUrl.replace(/\/+$/, "")}/api`;

export const api = axios.create({
  baseURL,
});

api.interceptors.request.use(config => {
  const token = useAuth.getState().token;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});
