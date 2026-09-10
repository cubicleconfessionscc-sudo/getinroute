import React, { useRef } from "react";
import { View, Text, StyleSheet, PanResponder, Animated, Dimensions } from "react-native";
import { colors, radius } from "../theme";

const TRACK_WIDTH = Dimensions.get("window").width - 48;
const KNOB_SIZE = 56;
const SWIPE_THRESHOLD = TRACK_WIDTH - KNOB_SIZE - 12;

/**
 * A swipe-to-confirm control used for both:
 * - "Swipe right to check in" when boarding the vehicle
 * - "Swipe left to check out" when getting dropped off (pass direction="left")
 *
 * Calling onConfirm fires once the knob crosses the threshold; it snaps
 * back if released early.
 *
 * Fixes (Item 4):
 * - Keeps the latest onConfirm/disabled in refs so the pre-created PanResponder
 *   never fires a stale closure from an earlier render.
 * - Never permanently wedges the knob: when `disabled` becomes true (check-in
 *   completed) the knob locks in place; when it becomes false again (state
 *   resets) confirmed is cleared so the user can re-swipe.
 */
export default function SwipeButton({ label, direction = "right", color = colors.teal, onConfirm, disabled }) {
  const pan = useRef(new Animated.Value(0)).current;
  const confirmed = useRef(false);

  // Always-fresh props, read from inside the (once-created) PanResponder.
  const onConfirmRef = useRef(onConfirm);
  const disabledRef = useRef(disabled);
  onConfirmRef.current = onConfirm;
  disabledRef.current = disabled;

  const reset = () => {
    confirmed.current = false;
    Animated.spring(pan, { toValue: 0, useNativeDriver: false }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: (_, g) =>
        !disabledRef.current && (Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8),
      onPanResponderMove: (_, gesture) => {
        const dx = direction === "right" ? gesture.dx : -gesture.dx;
        const clamped = Math.max(0, Math.min(dx, SWIPE_THRESHOLD));
        pan.setValue(clamped);
      },
      onPanResponderRelease: (_, gesture) => {
        const dx = direction === "right" ? gesture.dx : -gesture.dx;
        if (dx >= SWIPE_THRESHOLD * 0.7 && !confirmed.current) {
          confirmed.current = true;
          Animated.timing(pan, {
            toValue: SWIPE_THRESHOLD,
            duration: 120,
            useNativeDriver: false
          }).start(() => onConfirmRef.current && onConfirmRef.current());
          // Give the parent a beat to flip `disabled` (e.g. after successful
          // check-in). If it doesn't, allow a re-swipe attempt later.
          setTimeout(() => {
            if (!disabledRef.current) reset();
          }, 1200);
        } else {
          reset();
        }
      }
    })
  ).current;

  const knobTranslate = direction === "right" ? pan : Animated.multiply(pan, -1);

  return (
    <View style={[styles.track, disabled && styles.trackDisabled]}>
      <Text style={styles.label}>{label}</Text>
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.knob,
          { backgroundColor: disabled ? colors.line : color },
          direction === "right"
            ? { left: 6, transform: [{ translateX: knobTranslate }] }
            : { right: 6, transform: [{ translateX: knobTranslate }] }
        ]}
      >
        <Text style={styles.arrow}>{direction === "right" ? "→" : "←"}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
    overflow: "hidden"
  },
  trackDisabled: { opacity: 0.5 },
  label: {
    color: colors.textDim,
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.3
  },
  knob: {
    position: "absolute",
    top: 4,
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    justifyContent: "center",
    alignItems: "center"
  },
  arrow: { color: "#0B0E12", fontSize: 22, fontWeight: "700" }
});
