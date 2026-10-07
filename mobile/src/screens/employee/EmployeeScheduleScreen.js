import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  Alert, Modal, TextInput, Switch, FlatList
} from "react-native";
import { getScheduleConfig, getMySchedules, createSchedule, cancelSchedule, updateSchedule, getMyAllotments } from "../../api/schedules";
import { getMyCompany } from "../../api/company";
import { getLocationProfile } from "../../api/locations";
import { speakTripScheduled, speakTripBooked } from "../../services/voice";
import { notifyTripBooked } from "../../services/notifications";
import { scheduleAlarmBefore } from "../../services/alarms";
import { colors, spacing, radius } from "../../theme";

function pad(n) {
  return String(n).padStart(2, "0");
}
function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function pickupDateTime(schedule) {
  const date = String(schedule?.startDate || schedule?.date || "").slice(0, 10);
  const time = String(schedule?.startTime || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const result = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (schedule?.nextDay) result.setDate(result.getDate() + 1);
  return Number.isNaN(result.getTime()) ? null : result;
}
function fmtPretty(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(String(dateStr).slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
function fmtTime12(t) {
  if (!t) return "—";
  const [hh, mm] = String(t).split(":").map((n) => parseInt(n, 10) || 0);
  const suffix = hh >= 12 ? "PM" : "AM";
  const h = hh % 12 === 0 ? 12 : hh % 12;
  return `${h}:${pad(mm)} ${suffix}`;
}

const DIR_LABEL = { toOffice: "Login", toHome: "Logout" };
const dirLabel = (dir) => DIR_LABEL[dir] || "Login";
const PICKUP_POINT = "Primary Pickup/Drop Point";

export default function EmployeeScheduleScreen({ navigation, route }) {
  // When opened from a schedule's "Edit" action, operate in EDIT mode on that
  // exact schedule id (never create a new one).
  const editSchedule = route?.params?.editSchedule || null;
  const editing = !!editSchedule;
  const [config, setConfig] = useState(null);
  const [company, setCompany] = useState(null);
  const [mine, setMine] = useState([]);
  const [allotted, setAllotted] = useState([]);
  const [dateMode, setDateMode] = useState("days");
  const [selectedDates, setSelectedDates] = useState([]);
  const [rangeStart, setRangeStart] = useState(null);
  const [rangeEnd, setRangeEnd] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [gateStatus, setGateStatus] = useState("loading"); // none | pending | rejected | approved

  // Login (go to work)
  const [loginOn, setLoginOn] = useState(false);
  const [loginOffice, setLoginOffice] = useState(null);
  const [loginSlot, setLoginSlot] = useState(null);

  // Logout (return home)
  const [logoutOn, setLogoutOn] = useState(false);
  const [logoutOffice, setLogoutOffice] = useState(null);
  const [logoutSlot, setLogoutSlot] = useState(null);
  const [logoutNextDay, setLogoutNextDay] = useState(false);

  // Modals
  const [officeModal, setOfficeModal] = useState(false);
  const [officeFor, setOfficeFor] = useState("login");
  const [officeSearch, setOfficeSearch] = useState("");
  const [shiftModal, setShiftModal] = useState(false);
  const [shiftFor, setShiftFor] = useState("login");
  const [shiftPick, setShiftPick] = useState(null);

  const load = useCallback(async () => {
    const [cfg, my, al, comp, loc] = await Promise.all([
      getScheduleConfig(), getMySchedules(), getMyAllotments(), getMyCompany(),
      getLocationProfile().catch(() => ({ locationStatus: "none" }))
    ]);
    setConfig(cfg);
    setMine(my);
    setAllotted(al);
    setCompany(comp);
    setGateStatus(loc?.locationStatus || "none");
    const nodal = comp?.nodalPoints || [];
    if (nodal.length) {
      if (!loginOffice) setLoginOffice(nodal[0]);
      if (!logoutOffice) setLogoutOffice(nodal[0]);
    }
    if (!loginSlot && cfg.loginTimes && cfg.loginTimes.length) setLoginSlot(cfg.loginTimes[0]);
    if (!logoutSlot && cfg.logoutTimes && cfg.logoutTimes.length) setLogoutSlot(cfg.logoutTimes[0]);
  }, []);

  useEffect(() => {
    load().catch((e) => Alert.alert("Error", e.response?.data?.message || e.message));
  }, [load]);

  // Prefill the form from the schedule being edited.
  useEffect(() => {
    if (!editSchedule) return;
    const date = String(editSchedule.date || editSchedule.startDate || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setDateMode("days");
      setSelectedDates([new Date(date + "T00:00:00")]);
    }
    const dir = editSchedule.direction === "toHome" ? "toHome" : "toOffice";
    setLoginOn(dir === "toOffice");
    setLogoutOn(dir === "toHome");
  }, [editSchedule]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } catch (e) {}
    setRefreshing(false);
  };

  const dayOptions = [];
  const now = new Date();
  dayOptions.push(new Date(now));
  for (let i = 1; i <= 29; i++) {
    const day = new Date(now);
    day.setDate(now.getDate() + i);
    dayOptions.push(day);
  }

  const nodal = company?.nodalPoints || [];
  const canBook = gateStatus === "approved";

  function openGate() {
    navigation.navigate("EmployeeLocations");
  }

  function gateCopy() {
    if (gateStatus === "none") {
      return { title: "Home address required", body: "Submit your home address before you can book a cab. The transport admin will review and approve it." };
    }
    if (gateStatus === "rejected") {
      return { title: "Address update rejected", body: "Your address was rejected. Please correct the details in My Locations and resubmit." };
    }
    return { title: "Address verification is pending", body: "Your address has been submitted and is awaiting admin approval. Scheduling opens up as soon as it's approved." };
  }

  function openOfficePicker(forDir) {
    setOfficeFor(forDir);
    setOfficeSearch("");
    setOfficeModal(true);
  }

  function pickOffice(np) {
    if (officeFor === "login") setLoginOffice(np);
    else setLogoutOffice(np);
    setOfficeModal(false);
  }

  function openShiftPicker(forDir) {
    setShiftFor(forDir);
    setShiftPick(forDir === "login" ? loginSlot : logoutSlot);
    setShiftModal(true);
  }

  function applyShift() {
    if (shiftFor === "login") setLoginSlot(shiftPick);
    else setLogoutSlot(shiftPick);
    setShiftModal(false);
  }

  const filteredOffices = nodal.filter((np) => {
    const q = officeSearch.trim().toLowerCase();
    if (!q) return true;
    return `${np.label || ""} ${np.address || ""}`.toLowerCase().includes(q);
  });

  async function submit() {
    if (!canBook) return openGate();
    // EDIT mode: update the existing schedule in place (no duplicate created).
    if (editing) {
      if (!loginOn && !logoutOn) return Alert.alert("Nothing selected", "Select Login (go to work) or Logout (return home).");
      const date = effectiveDates.length ? fmtDate(effectiveDates[0]) : String(editSchedule.date || "").slice(0, 10);
      const payload = { date };
      if (loginOn) { payload.direction = "toOffice"; payload.login_time = loginSlot?.time || null; payload.pickup_time = loginSlot?.time || null; }
      else { payload.direction = "toHome"; payload.logout_time = logoutSlot?.time || null; payload.drop_time = logoutSlot?.time || null; }
      setSubmitting(true);
      try {
        await updateSchedule(editSchedule.id || editSchedule._id, payload);
        Alert.alert("Schedule updated", "Your changes were saved.");
        navigation.goBack();
      } catch (e) { Alert.alert("Update failed", e.response?.data?.message || e.message); }
      finally { setSubmitting(false); }
      return;
    }
    if (!loginOn && !logoutOn) {
      Alert.alert("Nothing selected", "Select Login (go to work) and/or Logout (return home).");
      return;
    }
    if (!effectiveDates.length) {
      Alert.alert("Pick dates", "Choose at least one travel date to continue.");
      return;
    }
    const dates = effectiveDates.map(fmtDate);
    const jobs = [];
    if (loginOn) {
      if (!loginOffice) return Alert.alert("Pick an office", "Choose the office for the Login trip.");
      if (!loginSlot) return Alert.alert("Pick a time", "Choose the pickup time for the Login trip.");
      jobs.push(createSchedule({
        dates,
        direction: "toOffice",
        officePointId: String(loginOffice._id),
        startTime: loginSlot.time,
        slotLabel: loginSlot.label
      }));
    }
    if (logoutOn) {
      if (!logoutOffice) return Alert.alert("Pick an office", "Choose the office for the Logout trip.");
      if (!logoutSlot) return Alert.alert("Pick a time", "Choose the pickup time for the Logout trip.");
      jobs.push(createSchedule({
        dates,
        direction: "toHome",
        officePointId: String(logoutOffice._id),
        startTime: logoutSlot.time,
        slotLabel: logoutSlot.label,
        nextDay: logoutNextDay
      }));
    }
    setSubmitting(true);
    try {
      const results = await Promise.all(jobs);
      const lines = [];
      const skipped = [];
      let anyPending = false;
        results.forEach((r) => {
          (r.created || (r._id ? [r] : [])).forEach((s) => {
            if (s.status === "requested") anyPending = true;
            lines.push(`${dirLabel(s.direction)} · ${fmtPretty(s.startDate)} · pickup ${fmtTime12(s.startTime)} · ${s.status === "requested" ? "awaiting approval" : "confirmed"}`);
            const alarmAt = pickupDateTime(s);
            if (alarmAt) {
              scheduleAlarmBefore(alarmAt, {
                title: "Employee pickup alarm",
                body: `Your ${dirLabel(s.direction).toLowerCase()} pickup is at ${fmtTime12(s.startTime)}.`,
                alarmKey: `employee:${s._id || "schedule"}:${String(s.startDate || s.date || "").slice(0, 10)}`,
              }).catch(() => {});
            }
          });
        if (r.pendingApproval) anyPending = true;
        if (r.skipped && r.skipped.length) skipped.push(...r.skipped);
      });
      if (lines.length) {
        Alert.alert(anyPending ? "Requests sent for approval" : "Schedule created", lines.join("\n") + (skipped.length ? `\n\nSkipped: ${skipped.join(", ")}` : "") + (anyPending ? "\n\nThe transport admin will confirm your cab shortly. You'll get a notification once it's approved." : ""));
        // Voice + local notification at the moment the booking is made (item 1).
        if (anyPending) {
          speakTripBooked();
          notifyTripBooked();
        } else {
          speakTripScheduled();
        }
      } else {
        Alert.alert("No new bookings", skipped.length ? `Skipped: ${skipped.join(", ")}` : "You already have these bookings.");
      }
      clearDates();
      await load();
    } catch (e) {
      Alert.alert("Booking failed", e.response?.data?.message || e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function cancel(id) {
    Alert.alert(
      "Cancel this trip?",
      "Are you sure you want to cancel this trip? This cannot be undone.",
      [
        { text: "Keep Trip", style: "cancel" },
        {
          text: "Cancel Trip",
          style: "destructive",
          onPress: async () => {
            try {
              await cancelSchedule(id);
              await load();
            } catch (e) {
              Alert.alert("Could not cancel", e.response?.data?.message || e.message);
            }
          }
        }
      ]
    );
  }

  const effectiveDates = [];
  if (dateMode === "range" && rangeStart && rangeEnd) {
    const s = new Date(rangeStart);
    const e = new Date(rangeEnd);
    for (const cur = new Date(s); cur <= e; cur.setDate(cur.getDate() + 1)) {
      effectiveDates.push(new Date(cur));
    }
  } else if (dateMode === "days") {
    selectedDates.slice().sort((a, b) => a - b).forEach((d) => effectiveDates.push(new Date(d)));
  }

  function toggleDay(d) {
    if (!canBook) return;
    const ds = fmtDate(d);
    if (dateMode === "days") {
      setSelectedDates((prev) =>
        prev.some((x) => fmtDate(x) === ds) ? prev.filter((x) => fmtDate(x) !== ds) : [...prev, d]
      );
    } else {
      if (!rangeStart || (rangeStart && rangeEnd)) {
        setRangeStart(d);
        setRangeEnd(null);
      } else {
        if (fmtDate(d) < fmtDate(rangeStart)) {
          setRangeEnd(new Date(rangeStart));
          setRangeStart(d);
        } else {
          setRangeEnd(d);
        }
      }
    }
  }

  function clearDates() {
    setSelectedDates([]);
    setRangeStart(null);
    setRangeEnd(null);
  }

  const countLabel =
    dateMode === "range"
      ? (rangeStart && rangeEnd
          ? `${fmtPretty(fmtDate(rangeStart))} – ${fmtPretty(fmtDate(rangeEnd))} · ${effectiveDates.length} day(s)`
          : rangeStart ? `Start ${fmtPretty(fmtDate(rangeStart))} — tap the end date` : "Tap a start date")
      : `${effectiveDates.length} day(s) selected`;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.teal} />}
    >
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>{editing ? "Edit Schedule" : "Create Schedule"}</Text>
        <Text style={styles.bannerBody}>
          Tell us when you're coming to the office and heading back.{"\n"}
          {config ? (
            config.loginTimes && config.loginTimes.length && config.logoutTimes && config.logoutTimes.length ? (
              `Pick your LOGIN time and your LOGOUT time separately — each has its own cutoff. Times already closed for today are greyed out.`
            ) : (
              "Shift timings not set — please check with admin."
            )
          ) : ""}
        </Text>
      </View>

      {gateStatus !== "loading" && !canBook && (
        <View style={[styles.section, styles.gateCard]}>
          <View style={styles.gateIconWrap}>
            <Text style={styles.gateIcon}>⚠</Text>
          </View>
          <View style={styles.gateTextWrap}>
            <Text style={styles.gateTitle}>{gateCopy().title}</Text>
            <Text style={styles.gateBody}>{gateCopy().body}</Text>
            {gateStatus !== "loading" && (
              <TouchableOpacity onPress={openGate}>
                <Text style={styles.gateCta}>{gateStatus === "pending" ? "Check status in My Locations" : "Submit your address"}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.label}>Travel dates</Text>
        <View style={styles.modeRow}>
          {[{ key: "days", label: "Pick specific days" }, { key: "range", label: "Pick a date range" }].map((m) => (
            <TouchableOpacity
              key={m.key}
              style={[styles.modeBtn, dateMode === m.key && styles.modeBtnOn, !canBook && styles.controlLocked]}
              onPress={() => { if (!canBook) return openGate(); setDateMode(m.key); clearDates(); }}
            >
              <Text style={[styles.modeBtnText, dateMode === m.key && styles.modeBtnTextOn]}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {dayOptions.map((d) => {
            const ds = fmtDate(d);
            const sel = dateMode === "range"
              ? (rangeStart && rangeEnd && ds >= fmtDate(rangeStart) && ds <= fmtDate(rangeEnd))
              : selectedDates.some((x) => fmtDate(x) === ds);
            return (
              <TouchableOpacity
                key={ds}
                style={[styles.chip, sel && styles.chipSelected, !canBook && styles.controlLocked]}
                onPress={() => toggleDay(d)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipDay, sel && styles.chipTextSelected]}>
                  {d.toLocaleDateString(undefined, { weekday: "short" })}
                </Text>
                <Text style={[styles.chipDate, sel && styles.chipTextSelected]}>
                  {d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <Text style={styles.countLabel}>{countLabel}</Text>
        {config && (!config.loginTimes || !config.loginTimes.length) && (!config.logoutTimes || !config.logoutTimes.length) ? (
          <Text style={styles.noShifts}>Shift timings not set for today — please check with admin.</Text>
        ) : null}
      </View>

      {/* Login (go to work) */}
      <View style={[styles.section, styles.card]}>
        <TouchableOpacity style={[styles.checkRow, !canBook && styles.controlLocked]} onPress={() => { if (!canBook) return openGate(); setLoginOn(!loginOn); }}>
          <View style={[styles.checkbox, loginOn && styles.checkboxOn]}>
            {loginOn && <Text style={styles.checkboxTick}>✓</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.checkTitle}>Login</Text>
            <Text style={styles.checkSub}>Go to work</Text>
          </View>
        </TouchableOpacity>

        {loginOn && (
          <View style={styles.cardBody}>
            <TouchableOpacity style={styles.routeRow} onPress={() => openOfficePicker("login")}>
              <Text style={styles.routeLabel}>Route</Text>
              <Text style={styles.routeText} numberOfLines={1}>
                {PICKUP_POINT} → <Text style={styles.routeStrong}>{loginOffice?.label || "Select office"}</Text>
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.routeRow} onPress={() => openShiftPicker("login")}>
              <Text style={styles.routeLabel}>Time</Text>
              <Text style={[styles.routeText, loginSlot && loginSlot.closedForToday && { color: colors.coral }]}>
                {loginSlot ? fmtTime12(loginSlot.time) : "Select time"}
                {loginSlot && loginSlot.closedForToday ? ` · Closed (cutoff ${loginSlot.cutoffTimeLabel})` : ""}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Logout (return home) */}
      <View style={[styles.section, styles.card]}>
        <TouchableOpacity style={[styles.checkRow, !canBook && styles.controlLocked]} onPress={() => { if (!canBook) return openGate(); setLogoutOn(!logoutOn); }}>
          <View style={[styles.checkbox, logoutOn && styles.checkboxOn]}>
            {logoutOn && <Text style={styles.checkboxTick}>✓</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.checkTitle}>Logout</Text>
            <Text style={styles.checkSub}>Return home</Text>
          </View>
          <Switch
            value={logoutNextDay}
            onValueChange={setLogoutNextDay}
            disabled={!logoutOn}
            trackColor={{ false: colors.line, true: colors.violet }}
            thumbColor={logoutNextDay ? "#FFFFFF" : "#FFFFFF"}
          />
        </TouchableOpacity>

        {logoutOn && (
          <View style={styles.cardBody}>
            <View style={styles.nextDayRow}>
              <Text style={styles.nextDayLabel}>Logout on next day</Text>
              <Text style={styles.nextDayHint}>{logoutNextDay ? "Overnight shift — pickup the next day" : "Same-day return"}</Text>
            </View>
            <TouchableOpacity style={styles.routeRow} onPress={() => openOfficePicker("logout")}>
              <Text style={styles.routeLabel}>Route</Text>
              <Text style={styles.routeText} numberOfLines={1}>
                <Text style={styles.routeStrong}>{logoutOffice?.label || "Select office"}</Text> → {PICKUP_POINT}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.routeRow} onPress={() => openShiftPicker("logout")}>
              <Text style={styles.routeLabel}>Time</Text>
              <Text style={[styles.routeText, logoutSlot && logoutSlot.closedForToday && { color: colors.coral }]}>
                {logoutSlot ? fmtTime12(logoutSlot.time) : "Select time"}
                {logoutSlot && logoutSlot.closedForToday ? ` · Closed (cutoff ${logoutSlot.cutoffTimeLabel})` : ""}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <TouchableOpacity style={[styles.submit, (submitting || !canBook) && styles.submitLocked]} onPress={submit} disabled={submitting || !canBook}>
        <Text style={styles.submitText}>{!canBook ? "Address approval required" : submitting ? "Saving…" : editing ? "Save Changes" : "Create Schedule"}</Text>
      </TouchableOpacity>

      <View style={styles.section}>
        <Text style={styles.label}>Allotted cab & drop order</Text>
        {allotted.length === 0 ? (
          <Text style={styles.none}>
            No cab allotted yet. Once admin assigns a vehicle and driver, you'll see it here with your drop position.
          </Text>
        ) : (
          allotted.map((a) => {
            const v = a.vehicle || {};
            const d = a.driver || {};
            const seq = Array.isArray(a.sequence) ? a.sequence : [];
            return (
              <View key={a._id} style={styles.allotment}>
                <View style={styles.allotTop}>
                  <View style={styles.allotBadgeWrap}>
                    <Text style={styles.allotBadge}>Drop #{a.myOrder ?? "–"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bookingTitle}>{fmtPretty(a.date)} · {dirLabel(a.direction)} · {a.slotLabel || "Shift"}</Text>
                    <Text style={styles.bookingSub}>
                      {v.vehicleNumber ? `${v.vehicleNumber} · ${v.vehicleType} (${v.seatCapacity} seats)` : "Vehicle TBD"} ·
                      {a.vendorName ? ` ${a.vendorName} ·` : ""}
                      {d.name ? ` ${d.name}${d.phone ? ` · ${d.phone}` : ""}` : " driver TBD"}
                    </Text>
                  </View>
                </View>
                <View style={styles.seq}>
                  {seq.map((e) => (
                    <View key={String(e.order)} style={[styles.seqRow, e.isMe && styles.seqRowMe]}>
                      <View style={[styles.seqBadge, e.isMe && styles.seqBadgeMe]}>
                        <Text style={[styles.seqBadgeText, e.isMe && styles.seqBadgeTextMe]}>{e.order + 1}</Text>
                      </View>
                      <Text style={[styles.seqName, e.isMe && styles.seqNameMe]}>{e.isMe ? "You" : e.name}</Text>
                      {e.isMe && <Text style={styles.seqYou}>this is you</Text>}
                    </View>
                  ))}
                </View>
              </View>
            );
          })
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>My cab bookings</Text>
        {mine.length === 0 ? (
          <Text style={styles.none}>No bookings yet. Book your cab above.</Text>
        ) : (
          mine.map((s) => (
            <View key={s._id} style={styles.booking}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bookingTitle}>
                  {dirLabel(s.direction)} · {fmtPretty(s.startDate)}{s.nextDay ? " (next day)" : ""}
                </Text>
                <Text style={styles.bookingSub}>
                  {s.slotLabel || "Shift"} · pickup {fmtTime12(s.startTime)} ·{" "}
                  {s.status === "requested" ? (
                    <Text style={{ color: colors.amber, fontWeight: "700" }}>waiting for admin approval</Text>
                  ) : (
                    s.status
                  )}
                </Text>
                {s.officeLocation?.label ? (
                  <Text style={styles.bookingOffice}>{s.officeLocation.label}</Text>
                ) : null}
              </View>
              {s.status === "confirmed" && (
                <TouchableOpacity onPress={() => cancel(s._id)}>
                  <Text style={styles.cancel}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
      </View>

      {/* Office Address picker */}
      <Modal visible={officeModal} animationType="slide" transparent onRequestClose={() => setOfficeModal(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Office Address</Text>
              <TouchableOpacity onPress={() => setOfficeModal(false)}>
                <Text style={styles.modalClose}>Close</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.search}
              placeholder="Search office…"
              placeholderTextColor={colors.textDim}
              value={officeSearch}
              onChangeText={setOfficeSearch}
              autoCapitalize="words"
            />
            <FlatList
              data={filteredOffices}
              keyExtractor={(np) => String(np._id)}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.none}>No offices found.</Text>}
              renderItem={({ item: np }) => (
                <TouchableOpacity style={styles.officeRow} onPress={() => pickOffice(np)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.officeLabel}>{np.label || "Office"}</Text>
                    {np.address ? <Text style={styles.officeAddress} numberOfLines={1}>{np.address}</Text> : null}
                  </View>
                  <Text style={styles.officePick}>Select →</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Select Shift time sheet */}
      <Modal visible={shiftModal} animationType="slide" transparent onRequestClose={() => setShiftModal(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <View style={styles.modalHead}>
              <View>
                <Text style={styles.modalTitle}>Select {shiftFor === "login" ? "LOGIN" : "LOGOUT"} time</Text>
                {effectiveDates[0] && <Text style={styles.modalSub}>{fmtPretty(fmtDate(effectiveDates[0]))}{effectiveDates.length > 1 ? ` +${effectiveDates.length - 1} more` : ""} · {shiftFor === "login" ? "Login (go to work)" : "Logout (return home)"}</Text>}
              </View>
              <TouchableOpacity onPress={() => setShiftModal(false)}>
                <Text style={styles.modalClose}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {(() => {
                const list = shiftFor === "login" ? (config?.loginTimes || []) : (config?.logoutTimes || []);
                return !list.length ? (
                  <Text style={styles.none}>Shift timings not set — please check with admin.</Text>
                ) : (
                  list.map((s) => {
                    const selected = shiftPick && shiftPick.label === s.label;
                    const closed = !!s.closedForToday;
                    return (
                      <TouchableOpacity
                        key={s.label}
                        disabled={closed}
                        style={[styles.slotRow, selected && styles.slotRowSelected, closed && styles.slotRowClosed]}
                        onPress={() => setShiftPick(s)}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.slotTime, selected && styles.slotTimeSelected, closed && styles.slotTimeClosed]}>
                            {fmtTime12(s.time)}{closed ? " · Closed" : ""}
                          </Text>
                          <Text style={[styles.slotSub, closed && styles.slotTimeClosed]}>
                            {s.label} · {closed ? `cutoff was ${s.cutoffTimeLabel || "—"}` : `open until ${s.cutoffTimeLabel || "—"}`}
                          </Text>
                        </View>
                        <View style={[styles.radio, selected && styles.radioSelected]} />
                      </TouchableOpacity>
                    );
                  })
                );
              })()}
            </ScrollView>
            <TouchableOpacity style={styles.applyBtn} onPress={applyShift}>
              <Text style={styles.applyText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  banner: { padding: spacing.lg, paddingBottom: spacing.sm },
  bannerTitle: { color: colors.text, fontSize: 22, fontWeight: "700" },
  bannerBody: { color: colors.textDim, fontSize: 13, marginTop: 6, lineHeight: 19 },
  section: { padding: spacing.lg, paddingTop: spacing.sm },
  label: { color: colors.textDim, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 },
  chips: { gap: 8, paddingBottom: 4 },
  chip: { alignItems: "center", paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel },
  chipSelected: { borderColor: colors.teal, backgroundColor: "rgba(0,217,192,0.12)" },
  chipDay: { color: colors.textDim, fontSize: 11, textTransform: "uppercase" },
  chipDate: { color: colors.text, fontSize: 14, fontWeight: "700", marginTop: 2 },
  chipTextSelected: { color: colors.teal },
  modeRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  modeBtn: {
    flex: 1, paddingVertical: 9, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.panel, alignItems: "center"
  },
  modeBtnOn: { borderColor: colors.teal, backgroundColor: "rgba(0,217,192,0.12)" },
  modeBtnText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  modeBtnTextOn: { color: colors.teal },
  countLabel: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 10 },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, marginHorizontal: spacing.lg, marginTop: spacing.sm, padding: spacing.md, paddingTop: spacing.sm },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 4 },
  checkbox: {
    width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: colors.line,
    backgroundColor: colors.bg, alignItems: "center", justifyContent: "center"
  },
  checkboxOn: { borderColor: colors.teal, backgroundColor: colors.teal },
  checkboxTick: { color: "#02201C", fontSize: 15, fontWeight: "800" },
  checkTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  checkSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  cardBody: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm },
  nextDayRow: { paddingVertical: spacing.sm },
  nextDayLabel: { color: colors.text, fontSize: 13, fontWeight: "600" },
  nextDayHint: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  routeRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, gap: spacing.md },
  routeLabel: { color: colors.textDim, fontSize: 12, width: 46, textTransform: "uppercase", letterSpacing: 0.5 },
  routeText: { color: colors.text, fontSize: 13, flex: 1 },
  routeStrong: { color: colors.teal, fontWeight: "700" },
  submit: { backgroundColor: colors.teal, borderRadius: radius.md, padding: spacing.md, alignItems: "center", marginHorizontal: spacing.lg, marginTop: spacing.md },
  submitText: { color: "#02201C", fontSize: 15, fontWeight: "700" },
  none: { color: colors.textDim, fontSize: 13 },
  noShifts: { color: colors.coral, fontSize: 13, marginTop: 8 },
  gateCard: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, backgroundColor: "rgba(255,176,32,0.08)", borderWidth: 1, borderColor: colors.amber, borderRadius: radius.lg, marginHorizontal: spacing.lg, marginTop: spacing.sm, padding: spacing.md },
  gateIconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.amber, alignItems: "center", justifyContent: "center" },
  gateIcon: { color: "#1A1400", fontSize: 17, fontWeight: "800" },
  gateTextWrap: { flex: 1 },
  gateTitle: { color: colors.amber, fontSize: 14, fontWeight: "800" },
  gateBody: { color: colors.textDim, fontSize: 13, marginTop: 4, lineHeight: 19 },
  gateCta: { color: colors.amber, fontSize: 13, fontWeight: "700", marginTop: 8 },
  controlLocked: { opacity: 0.5 },
  submitLocked: { opacity: 0.5, backgroundColor: colors.amber },
  allotment: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.violet,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md
  },
  allotTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  allotBadgeWrap: { alignItems: "flex-start" },
  allotBadge: {
    color: "#FFFFFF", backgroundColor: colors.violet, fontSize: 12, fontWeight: "700",
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius.sm, overflow: "hidden"
  },
  seq: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm },
  seqRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 10 },
  seqRowMe: { backgroundColor: "rgba(139,124,246,0.10)", borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 5 },
  seqBadge: {
    width: 22, height: 22, borderRadius: 6, backgroundColor: colors.line,
    alignItems: "center", justifyContent: "center"
  },
  seqBadgeMe: { backgroundColor: colors.violet },
  seqBadgeText: { color: colors.textDim, fontSize: 11, fontWeight: "700" },
  seqBadgeTextMe: { color: "#FFFFFF" },
  seqName: { color: colors.text, fontSize: 13, flex: 1 },
  seqNameMe: { color: colors.text, fontWeight: "700" },
  seqYou: { color: colors.violet, fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  booking: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.panel, borderWidth: 1,
    borderColor: colors.line, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm
  },
  bookingTitle: { color: colors.text, fontSize: 14, fontWeight: "600" },
  bookingSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  bookingOffice: { color: colors.teal, fontSize: 12, marginTop: 2 },
  cancel: { color: colors.coral, fontSize: 13, fontWeight: "600", marginLeft: spacing.md },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modal: { backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: "75%", padding: spacing.lg },
  modalHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: spacing.md },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  modalSub: { color: colors.textDim, fontSize: 12, marginTop: 4 },
  modalClose: { color: colors.coral, fontSize: 14, fontWeight: "600" },
  search: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    color: colors.text, padding: spacing.md, marginBottom: spacing.md, fontSize: 14
  },
  officeRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.panel, borderWidth: 1,
    borderColor: colors.line, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm
  },
  officeLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  officeAddress: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  officePick: { color: colors.teal, fontSize: 13, fontWeight: "700", marginLeft: spacing.md },
  slotRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.panel, borderWidth: 1,
    borderColor: colors.line, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm
  },
  slotRowSelected: { borderColor: colors.teal, backgroundColor: "rgba(0,217,192,0.10)" },
  slotRowClosed: { borderColor: colors.line, backgroundColor: "rgba(140,151,168,0.08)", opacity: 0.7 },
  slotTimeClosed: { color: colors.textDim },
  slotTime: { color: colors.text, fontSize: 16, fontWeight: "700" },
  slotTimeSelected: { color: colors.teal },
  slotSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.line, marginLeft: spacing.md },
  radioSelected: { borderColor: colors.teal, backgroundColor: colors.teal },
  applyBtn: { backgroundColor: colors.teal, borderRadius: radius.md, padding: spacing.md, alignItems: "center", marginTop: spacing.sm },
  applyText: { color: "#02201C", fontSize: 15, fontWeight: "700" }
});
