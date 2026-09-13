import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, spacing, radius } from "../theme";
import client from "../api/client";

const STATUS_CONFIG = {
  ACTIVE: { bg: "rgba(0,217,192,0.12)", color: colors.teal, label: "Active" },
  TRIAL_ACTIVE: { bg: "rgba(0,217,192,0.12)", color: colors.teal, label: "Free Trial" },
  TRIAL_EXPIRING: { bg: "rgba(199,126,0,0.12)", color: colors.amber, label: "Trial Expiring" },
  TRIAL_EXPIRED: { bg: "rgba(226,59,59,0.12)", color: colors.coral, label: "Trial Expired" },
  PAYMENT_REQUIRED: { bg: "rgba(226,59,59,0.12)", color: colors.coral, label: "Payment Required" },
  PAYMENT_SUBMITTED: { bg: "rgba(139,124,246,0.12)", color: colors.violet, label: "Payment Under Review" },
  PAYMENT_VERIFIED: { bg: "rgba(0,217,192,0.12)", color: colors.teal, label: "Payment Verified" },
  PAYMENT_DUE: { bg: "rgba(199,126,0,0.12)", color: colors.amber, label: "Payment Due" },
  GRACE_PERIOD: { bg: "rgba(226,59,59,0.12)", color: colors.coral, label: "Grace Period" },
  SUSPENDED: { bg: "rgba(226,59,59,0.12)", color: colors.coral, label: "Suspended" },
  EXPIRED: { bg: "rgba(226,59,59,0.12)", color: colors.coral, label: "Expired" },
  PENDING_APPROVAL: { bg: "rgba(199,126,0,0.12)", color: colors.amber, label: "Pending Approval" },
  TERMINATED: { bg: "rgba(91,102,117,0.12)", color: colors.textDim, label: "Terminated" },
};

export default function SubscriptionStatusBar({ companyId, compact }) {
  const [status, setStatus] = useState(null);
  const [daysLeft, setDaysLeft] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    client
      .get(`/v3/subscription/company/${companyId}`)
      .then((r) => r.data)
      .then((r) => {
        setStatus(r?.status || r?.subscription?.status || null);
        setDaysLeft(r?.days_remaining ?? null);
      })
      .catch(() => {});
  }, [companyId]);

  if (!status) return null;

  const cfg = STATUS_CONFIG[status] || { bg: "rgba(91,102,117,0.12)", color: colors.textDim, label: status };

  if (compact) {
    return (
      <View style={[styles.pill, { backgroundColor: cfg.bg }]}>
        <View style={[styles.dot, { backgroundColor: cfg.color }]} />
        <Text style={[styles.pillText, { color: cfg.color }]}>
          {cfg.label}
          {daysLeft != null ? ` (${daysLeft}d)` : ""}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.banner, { backgroundColor: cfg.bg, borderColor: cfg.color }]}>
      <View style={styles.bannerRow}>
        <View style={[styles.dot, { backgroundColor: cfg.color }]} />
        <Text style={[styles.bannerTitle, { color: cfg.color }]}>{cfg.label}</Text>
      </View>
      {daysLeft != null && (
        <Text style={styles.bannerSub}>
          {daysLeft > 0 ? `${daysLeft} days remaining` : "Expired"}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  pillText: { fontSize: 11, fontWeight: "700" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  banner: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
  },
  bannerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  bannerTitle: { fontSize: 14, fontWeight: "700" },
  bannerSub: { color: colors.textDim, fontSize: 12, marginTop: 4 },
});
