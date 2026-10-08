const ACCESS_STORAGE_KEY = "lms-access-key";

export function hasAccessKey() {
  return Boolean(sessionStorage.getItem(ACCESS_STORAGE_KEY));
}

export function saveAccessKey(key) {
  sessionStorage.setItem(ACCESS_STORAGE_KEY, key);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `lms_access=${encodeURIComponent(key)}; Path=/; SameSite=Strict${secure}`;
}

export function clearAccessKey() {
  sessionStorage.removeItem(ACCESS_STORAGE_KEY);
  document.cookie = "lms_access=; Path=/; Max-Age=0; SameSite=Strict";
}

export async function api(path) {
  const headers = {};
  const key = sessionStorage.getItem(ACCESS_STORAGE_KEY);
  if (key) headers["X-LMS-Access-Key"] = key;

  const response = await fetch(path, { headers });
  if (!response.ok) {
    let detail = `Permintaan gagal (${response.status})`;
    let code = "";
    try {
      const body = await response.json();
      if (body.detail) detail = String(body.detail);
      if (body.code) code = String(body.code);
    } catch {
      /* response was not JSON */
    }
    const error = new Error(detail);
    error.status = response.status;
    error.code = code;
    throw error;
  }
  return response.json();
}
