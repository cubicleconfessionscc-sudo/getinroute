import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, KeyboardAvoidingView, Platform, Linking, Alert } from "react-native";
import client from "../../api/client";
import { connectSocket, joinTrip, leaveTrip, sendChatMessage } from "../../services/socket";
import { useAuth } from "../../context/AuthContext";
import { colors, spacing, radius } from "../../theme";

const QUICK_REPLIES = [
  "I reached the pickup point",
  "I'm at the pickup point, waiting",
  "Running 5 minutes late",
  "Can you wait 2 minutes?",
  "On my way",
  "Thank you!"
];

const ROLE_LABEL = { driver: "Driver", employee: "Employee", admin: "Admin" };

export default function ChatScreen({ route }) {
  const { tripId } = route.params;
  const phone = route.params?.phone || "";
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const listRef = useRef(null);
  const seenIdsRef = useRef(new Set());

  // Merge a message only once (broadcasts can race the initial history load).
  function mergeMessage(msg) {
    setMessages((prev) => {
      if (!msg || seenIdsRef.current.has(msg._id)) return prev;
      seenIdsRef.current.add(msg._id);
      return [...prev, msg];
    });
  }

  useEffect(() => {
    seenIdsRef.current = new Set();
    client.get(`/chat/trip/${tripId}`).then((r) => {
      const list = Array.isArray(r.data) ? r.data : [];
      list.forEach((m) => seenIdsRef.current.add(m._id));
      setMessages(list);
    }).catch(() => {});

    let socket;
    (async () => {
      socket = await connectSocket();
      joinTrip(tripId);
      socket.on("chat:broadcast", mergeMessage);
    })();

    return () => {
      leaveTrip(tripId);
      socket?.off("chat:broadcast", mergeMessage);
    };
  }, [tripId]);

  function handleSend(textToSend) {
    const t = (textToSend != null ? textToSend : text).trim();
    if (!t) return;
    sendChatMessage(tripId, t);
    setText("");
  }

  function callPhone() {
    if (!phone) return;
    Linking.openURL(`tel:${String(phone).replace(/[^+\d]/g, "")}`).catch(() =>
      Alert.alert("Can't call", "No phone app is available.")
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {phone ? (
        <TouchableOpacity style={styles.callBar} onPress={callPhone}>
          <Text style={styles.callBarText}>Need to talk? Call the other side</Text>
        </TouchableOpacity>
      ) : null}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item._id}
        contentContainerStyle={{ padding: spacing.lg }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const isMine = item.senderId === user?.id;
          return (
            <View style={[styles.bubbleRow, isMine && styles.bubbleRowMine]}>
              {!isMine ? (
                <Text style={styles.senderLabel}>{ROLE_LABEL[item.senderRole] || "Member"}</Text>
              ) : null}
              <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={styles.bubbleText}>{item.text}</Text>
                <Text style={[styles.timeText, isMine && styles.timeTextMine]}>
                  {item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                </Text>
              </View>
            </View>
          );
        }}
      />
      <View style={styles.chips}>
        {QUICK_REPLIES.map((q) => (
          <TouchableOpacity key={q} style={styles.chip} onPress={() => handleSend(q)}>
            <Text style={styles.chipText}>{q}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Message your driver/employee..."
          placeholderTextColor={colors.textDim}
        />
        <TouchableOpacity style={styles.sendButton} onPress={() => handleSend()}>
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  callBar: { backgroundColor: colors.violet, paddingVertical: 10, alignItems: "center" },
  callBarText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  bubbleRow: { marginBottom: 8, alignItems: "flex-start" },
  bubbleRowMine: { alignItems: "flex-end" },
  senderLabel: { color: colors.textDim, fontSize: 11, marginBottom: 3, marginLeft: 4 },
  bubble: { maxWidth: "78%", borderRadius: radius.md, padding: 10, paddingHorizontal: 14 },
  bubbleTheirs: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line },
  bubbleMine: { backgroundColor: colors.teal },
  bubbleText: { color: colors.text, fontSize: 14 },
  timeText: { color: colors.textDim, fontSize: 10, marginTop: 4, alignSelf: "flex-end" },
  timeTextMine: { color: "#02201C", opacity: 0.7 },
  chips: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.md, gap: 8, paddingBottom: 4 },
  chip: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { color: colors.teal, fontSize: 12.5, fontWeight: "600" },
  inputRow: { flexDirection: "row", padding: spacing.md, gap: 10, borderTopWidth: 1, borderTopColor: colors.line },
  input: { flex: 1, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, color: colors.text },
  sendButton: { backgroundColor: colors.teal, borderRadius: radius.md, paddingHorizontal: 18, justifyContent: "center" },
  sendButtonText: { color: "#02201C", fontWeight: "700" }
});
