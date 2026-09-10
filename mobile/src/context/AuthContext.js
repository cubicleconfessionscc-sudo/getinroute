import React, { createContext, useContext, useEffect, useState } from "react";
import * as authApi from "../api/auth";
import { saveToken, clearToken, getToken } from "../api/client";
import { connectSocket, disconnectSocket } from "../services/socket";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore the session on every launch: if a token is stored, ask the
    // server who it belongs to and refresh the token (slides the 30-day
    // window). A stored token alone used to be ignored, which is what
    // forced users to log back in every time the app was reopened.
    //
    // This block is wrapped in try/finally so `loading` ALWAYS resolves:
    // no token, a network hang, or a server error can never leave the app
    // stuck on a blank/white screen.
    (async () => {
      try {
        const token = await getToken();
        if (token) {
          try {
            const { token: freshToken, user: restored } = await authApi.me();
            await saveToken(freshToken);
            setUser(restored);
            await connectSocket();
          } catch (err) {
            // Only discard the token when the server actually rejected it
            // (401 expired / 403 suspended, rejected or pending). On network
            // errors or server hiccups we KEEP the token so the next launch
            // can retry - we never want a bad connection to force a re-login.
            const status = err?.response?.status;
            if (status === 401 || status === 403) {
              await clearToken();
            }
          }
        }
      } catch {
        // SecureStore or any other unexpected failure must not block the UI.
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(email, password) {
    const { token, user: loggedInUser } = await authApi.login(email, password);
    await saveToken(token);
    setUser(loggedInUser);
    await connectSocket();
    return loggedInUser;
  }

  async function register(payload) {
    const result = await authApi.register(payload);
    // Employees/drivers land in "pending" - no token issued yet.
    return result;
  }

  async function logout() {
    await clearToken();
    disconnectSocket();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
