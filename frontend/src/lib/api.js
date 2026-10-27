import axios from "axios";

const rawBase = (process.env.REACT_APP_BACKEND_URL || "").trim().replace(/\/+$/, "");
export const API = rawBase ? `${rawBase}/api` : "/api";

export const api = axios.create({ baseURL: API, withCredentials: true });
let refreshPromise = null;


api.interceptors.request.use((config) => {
  const token = localStorage.getItem("crm_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(undefined, async (error) => {
  const config = error.config;
  const authRoute = /\/auth\/(login|logout|refresh)$/.test(config?.url || "");
  if (error.response?.status !== 401 || !config || config._retry || authRoute) {
    return Promise.reject(error);
  }

  config._retry = true;
  try {
    if (!refreshPromise) {
      refreshPromise = axios.post(`${API}/auth/refresh`, null, { withCredentials: true })
        .then(({ data }) => {
          if (!data.access_token) throw new Error("Access token refresh failed");
          localStorage.setItem("crm_token", data.access_token);
          return data.access_token;
        })
        .finally(() => { refreshPromise = null; });
    }
    const token = await refreshPromise;
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
    return api(config);
  } catch {
    localStorage.removeItem("crm_token");
    return Promise.reject(error);
  }
});

export function apiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export function errMsg(e) {
  const serverDetail = e?.response?.data?.detail;
  if (serverDetail == null) return e?.message || "Something went wrong. Please try again.";
  const detail = apiError(serverDetail);
  if (detail.toLowerCase().includes("origin web server") || detail.toLowerCase().includes("cloudflare")) {
    return "Smartflo is temporarily unavailable. Please wait a moment and try again.";
  }
  return detail || e?.message || "Request failed";
}
