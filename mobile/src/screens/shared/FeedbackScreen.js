import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from "react-native";
import { submitFeedback } from "../../api/trips";
import { colors, spacing, radius } from "../../theme";

const REASONS = [
  "Driver was rude",
  "Late pickup",
  "Unsafe driving",
  "Vehicle was dirty",
  "Route was wrong",
  "AC not working",
  "Overcharging",
  "Didn't follow protocol",
  "Other"
];

export default function FeedbackScreen({ route, navigation }) {
  const tripId = route?.params?.tripId;
  const allotmentId = route?.params?.allotmentId;
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [selectedReasons, setSelectedReasons] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const showReasons = rating >= 1 && rating <= 3;

  function toggleReason(reason) {
    setSelectedReasons((prev) =>
      prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]
    );
  }

  async function handleSubmit() {
    if (!tripId && !allotmentId) {
      Alert.alert("No trip selected", "Please open feedback from a completed trip in your trip history.");
      return;
    }
    if (rating === 0) {
      Alert.alert("Add a rating", "Tap a star to rate the trip.");
      return;
    }
    setSubmitting(true);
    try {
      await submitFeedback(tripId || allotmentId, rating, comment, selectedReasons);
      Alert.alert("Thanks!", "Your feedback has been submitted.", [
        { text: "OK", onPress: () => navigation.goBack() }
      ]);
    } catch (err) {
      Alert.alert("Couldn't submit", err?.response?.data?.message || "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!tripId && !allotmentId) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>How was the trip?</Text>
        <Text style={{ color: colors.textDim, textAlign: "center", lineHeight: 20 }}>
          No trip ID was passed. Open feedback from a completed trip in your trip history to leave a rating.
        </Text>
        <TouchableOpacity
          style={[styles.button, { marginTop: 20 }]}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.buttonText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>How was the trip?</Text>

      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity key={n} onPress={() => setRating(n)}>
            <Text style={[styles.star, n <= rating && styles.starFilled]}>{'\u2605'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {rating > 0 && (
        <Text style={styles.ratingLabel}>
          {rating >= 4 ? "Great trip!" : rating === 3 ? "It was okay" : "Sorry to hear that"}
        </Text>
      )}

      {showReasons && (
        <View style={styles.reasonsSection}>
          <Text style={styles.reasonsLabel}>What went wrong? (optional)</Text>
          <View style={styles.reasonsWrap}>
            {REASONS.map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.reasonChip, selectedReasons.includes(r) && styles.reasonChipActive]}
                onPress={() => toggleReason(r)}
              >
                <Text style={[styles.reasonChipText, selectedReasons.includes(r) && styles.reasonChipTextActive]}>
                  {r}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <TextInput
        style={styles.input}
        value={comment}
        onChangeText={setComment}
        placeholder="Anything you'd like to add? (optional)"
        placeholderTextColor={colors.textDim}
        multiline
        numberOfLines={4}
      />

      <TouchableOpacity
        style={[styles.button, submitting && { opacity: 0.6 }]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        <Text style={styles.buttonText}>{submitting ? "Submitting..." : "Submit feedback"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, justifyContent: "center" },
  title: { color: colors.text, fontSize: 20, fontWeight: "700", marginBottom: spacing.lg, textAlign: "center" },
  stars: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 8 },
  star: { fontSize: 34, color: colors.line },
  starFilled: { color: colors.amber },
  ratingLabel: { color: colors.textDim, fontSize: 13, textAlign: "center", marginBottom: spacing.lg },
  reasonsSection: { marginBottom: spacing.lg },
  reasonsLabel: { color: colors.textDim, fontSize: 12, fontWeight: "600", marginBottom: 8, textAlign: "center" },
  reasonsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  reasonChip: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: colors.panel2 },
  reasonChipActive: { borderColor: colors.coral, backgroundColor: "rgba(239,68,68,0.12)" },
  reasonChipText: { color: colors.textDim, fontSize: 12, fontWeight: "600" },
  reasonChipTextActive: { color: colors.coral },
  input: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    padding: 14, color: colors.text, fontSize: 14, textAlignVertical: "top", minHeight: 100, marginBottom: spacing.lg
  },
  button: { backgroundColor: colors.teal, borderRadius: radius.md, padding: 16, alignItems: "center" },
  buttonText: { color: "#02201C", fontWeight: "700", fontSize: 15 }
});
