import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, PanResponder, Animated, Dimensions } from "react-native";
import { colors, radius } from "../theme";

const TRACK_WIDTH = Dimensions.get("window").width - 48;
const KNOB_SIZE = 56;
const SWIPE_THRESHOLD = TRACK_WIDTH - KNOB_SIZE - 12;
const CONFIRM_AT = 0.85; // release past 85% of the track to confirm

/**
 * Premium swipe-to-confirm control used for Check-in, Check-out, End trip and
 * Safety-reached. Gradient-ish track, progress fill following the thumb, label
 * that fades as you drag, spring-back if released early, a success tick + colour
 * change on completion, a disabled state with a reason, and a double-submit guard.
 * Works on small phones; a long-press also confirms (accessibility alternative).
 */
export default function SwipeButton({ label, direction = "right", color = colors.primary, onConfirm, disabled, disabledReason }) {
  const pan = useRef(new Animated.Value(0)).current;
  const confirmed = useRef(false);
  const [done, setDone] = useState(false);

  const onConfirmRef = useRef(onConfirm);
  const disabledRef = useRef(disabled);
  onConfirmRef.current = onConfirm;
  disabledRef.current = disabled;

  const fire = () => {
    if (confirmed.current) return;
    confirmed.current = true;
    setDone(true);
    Animated.timing(pan, { toValue: SWIPE_THRESHOLD, duration: 140, useNativeDriver: false }).start(() => {
      try { if (onConfirmRef.current) onConfirmRef.current(); } catch {}
    });
    setTimeout(() => {
      if (!disabledRef.current) {
        confirmed.current = false; setDone(false);
        Animated.spring(pan, { toValue: 0, useNativeDriver: false }).start();
      }
    }, 1400);
  };

  const reset = () => {
    confirmed.current = false; setDone(false);
    Animated.spring(pan, { toValue: 0, friction: 6, useNativeDriver: false }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: (_, g) => !disabledRef.current && (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6),
      onPanResponderMove: (_, g) => {
        const dx = direction === "right" ? g.dx : -g.dx;
        pan.setValue(Math.max(0, Math.min(dx, SWIPE_THRESHOLD)));
      },
      onPanResponderRelease: (_, g) => {
        const dx = direction === "right" ? g.dx : -g.dx;
        if (dx >= SWIPE_THRESHOLD * CONFIRM_AT) fire();
        else reset();
      },
      onPanResponderTerminate: () => reset()
    })
  ).current;

  const knobTranslate = direction === "right" ? pan : Animated.multiply(pan, -1);
  const fillWidth = Animated.add(pan, KNOB_SIZE);
  const labelOpacity = pan.interpolate({ inputRange: [0, SWIPE_THRESHOLD * 0.5], outputRange: [1, 0.25], extrapolate: "clamp" });

  return (
    <View style={[styles.track, disabled && styles.trackDisabled]}>
      <Animated.View style={[styles.fill, { width: fillWidth, backgroundColor: done ? colors.green : color }]} />
      <Animated.Text style={[styles.label, { opacity: labelOpacity }]} numberOfLines={1}>
        {disabled && disabledReason ? disabledReason : done ? "Confirmed" : label}
      </Animated.Text>
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.knob,
          { backgroundColor: disabled ? colors.line : (done ? colors.green : color) },
          direction === "right" ? { left: 6, transform: [{ translateX: knobTranslate }] } : { right: 6, transform: [{ translateX: knobTranslate }] }
        ]}
      >
        <Text style={styles.arrow}>{done ? "✓" : direction === "right" ? "→" : "←"}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH, height: 64, borderRadius: radius.pill,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line,
    justifyContent: "center", alignItems: "center", position: "relative", overflow: "hidden"
  },
  trackDisabled: { opacity: 0.55 },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.18 },
  label: { color: colors.text, fontSize: 14, fontWeight: "700", letterSpacing: 0.3, paddingHorizontal: 70, textAlign: "center" },
  knob: {
    position: "absolute", top: 4, width: KNOB_SIZE, height: KNOB_SIZE, borderRadius: KNOB_SIZE / 2,
    justifyContent: "center", alignItems: "center",
    shadowColor: "#0F1E3D", shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 5
  },
  arrow: { color: "#FFFFFF", fontSize: 22, fontWeight: "800" }
});
