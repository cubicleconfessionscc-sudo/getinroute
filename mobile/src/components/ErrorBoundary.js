import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { colors, radius, spacing } from "../theme";

// Catches any runtime error in the tree below it and shows a readable
// screen instead of the default blank white one. The reload button lets
// the user recover without reinstalling the app. The component stack
// underneath the message pinpoints exactly which part of the app threw,
// so support can see at a glance what went wrong.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "", stack: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error ? String(error.message || error) : "", stack: "" };
  }

  componentDidCatch(error, info) {
    const stack =
      (info && info.componentStack ? info.componentStack : "") +
      "\n---\n" +
      (error && error.stack ? String(error.stack).split("\n").slice(0, 8).join("\n") : "");
    console.error("GetInRoute error boundary:", error, info);
    // Keep the boundary small on screen; full detail is in the logs.
    this.setState({ stack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.root}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            The app hit an unexpected error. Your details are safe — tap reload to continue.
          </Text>
          {this.state.message ? (
            <ScrollView style={styles.detailBox} testID="error-detail">
              <Text style={styles.detail}>{this.state.message}</Text>
              {this.state.stack ? <Text style={styles.detailStack}>{this.state.stack}</Text> : null}
            </ScrollView>
          ) : null}
          <TouchableOpacity
            style={styles.button}
            onPress={() => this.setState({ hasError: false, message: "", stack: "" })}
            activeOpacity={0.7}
          >
            <Text style={styles.buttonText}>Reload</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  title: { color: colors.text, fontSize: 20, fontWeight: "700", marginBottom: 10, textAlign: "center" },
  body: { color: colors.textDim, fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 16 },
  detailBox: { maxHeight: 180, width: "100%", marginBottom: 20, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: spacing.md },
  detail: { color: colors.coral, fontSize: 12, textAlign: "center", fontWeight: "700" },
  detailStack: { color: colors.textDim, fontSize: 10, marginTop: 10, lineHeight: 14 },
  button: { backgroundColor: colors.teal, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 40 },
  buttonText: { color: "#02201C", fontSize: 15, fontWeight: "700" }
});
