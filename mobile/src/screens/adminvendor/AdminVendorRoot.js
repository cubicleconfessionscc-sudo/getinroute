import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, Text } from "react-native";
import { getToken, clearToken } from "../../api/client";
import { me, logout as apiLogout } from "../../api/adminvendor";
import { colors } from "../../theme";
import AdminVendorLogin from "./AdminVendorLogin";
import AdminVendorHome from "./AdminVendorHome";

// Root of the Admin/Vendor app. The login screen renders first; the stored
// session is restored in the background and, on any failure, the token is
// cleared so no previous user's data can leak into the next session.
export default function AdminVendorRoot() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (token) {
          try {
            const r = await me();
            const u = r.user || r;
            if (u && (u.role === "admin" || u.role === "vendor") && u.emp_id !== "ADMIN") {
              setUser(u); setMode(u.role === "vendor" ? "vendor" : "admin");
            } else { await clearToken(); }
          } catch { await clearToken(); }
        }
      } catch { /* storage unavailable — show login */ }
      finally { setBooting(false); }
    })();
  }, []);

  async function onLogout() {
    try { await apiLogout(); } catch { /* best-effort */ }
    await clearToken();
    setUser(null); setMode(null);
  }

  if (booting) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900", marginBottom: 12 }}>GetInRoute</Text>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!user) return <AdminVendorLogin onSuccess={(u, m) => { setUser(u); setMode(m); }} />;
  return <AdminVendorHome user={user} mode={mode} onLogout={onLogout} />;
}
