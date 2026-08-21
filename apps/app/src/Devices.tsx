/**
 * Pairing, and an honest account of what it does.
 *
 * The screen has one job beyond the two buttons: not to overstate the sync.
 * This transport works while both devices are awake, unlocked, on the same
 * network, and with AcctMind open. iOS suspends a backgrounded app and a
 * suspended app holds no listener, so a transaction added on a phone at a
 * café does not reach a Mac at home until both are open together again.
 * That is a real limit of syncing without a server, and a screen that showed
 * a tick and the word "Synced" would be lying about it — so this one says
 * when it last had a peer and what it is waiting for.
 */
import { useCallback, useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as peer from './peer';
import { SPACE, T, TAP } from './theme';

type Props = {
  visible: boolean;
  peers: number;
  onClose: () => void;
};

export function Devices({ visible, peers, onClose }: Props) {
  // A React Native Modal is its own window and sits OUTSIDE the app's safe
  // area, so the insets are re-applied here. Nothing in a browser catches
  // this: a browser has no status bar for the content to hide under.
  const insets = useSafeAreaInsets();

  const [paired, setPaired] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [copied, setCopied] = useState(false);

  // Read the pairing state on each open rather than holding it: it changes
  // from the other side of a native module.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setPaired(peer.paired());
      setCode(null);
      setTyped('');
      setError(null);
      setJoined(false);
      setCopied(false);
    }
  }

  const show = useCallback(() => {
    const c = peer.myCode();
    if (c === null) { setError('This device could not produce a pairing code.'); return; }
    setCode(c);
    setPaired(true);
  }, []);

  const join = useCallback(() => {
    const r = peer.acceptCode(typed);
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setPaired(true);
    setJoined(true);
    setTyped('');
  }, [typed]);

  const forget = useCallback(() => {
    peer.unpair();
    setPaired(false);
    setCode(null);
    setJoined(false);
  }, []);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={[styles.fill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.bar}>
          <Text style={styles.title} testID="devices-title">Devices</Text>
          <Pressable onPress={onClose} style={styles.barBtn} testID="devices-close">
            <Text style={styles.barBtnText}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Status paired={paired} peers={peers} />

          {error !== null && (
            <Text style={styles.error} testID="devices-error">{error}</Text>
          )}

          {code !== null && (
            <View style={styles.codeBox} testID="devices-code-box">
              <Text style={styles.label}>Type this on your other device</Text>
              <Text style={styles.code} testID="devices-code" selectable>{code}</Text>
              <Pressable
                onPress={() => {
                  // Twenty-five characters is a lot to retype. Copying it here
                  // and pasting on the other device is the same secret by a
                  // shorter road — and `parsePairCode` already forgives the
                  // whitespace a paste brings with it.
                  void Clipboard.setStringAsync(code)
                    .then(() => setCopied(true))
                    .catch(() => setError('This device would not reach the clipboard.'));
                }}
                style={styles.copyBtn}
                accessibilityRole="button"
                accessibilityLabel="Copy pairing code"
                testID="devices-copy-code"
              >
                <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy code'}</Text>
              </Pressable>
              <Text style={styles.hint}>
                It is the same code for every device you add. Anyone who has it
                can read this ledger on your network, so treat it like a wifi
                password.
              </Text>
            </View>
          )}

          {joined && (
            <Text style={styles.ok} testID="devices-joined">
              Paired. Open AcctMind on the other device and leave both on screen.
            </Text>
          )}

          <Pressable onPress={show} style={styles.button} testID="devices-show-code">
            <Text style={styles.buttonText}>
              {paired ? 'Show my pairing code' : 'Start a group and show the code'}
            </Text>
          </Pressable>

          <View style={styles.joinBox}>
            <Text style={styles.label}>Or type the code from another device</Text>
            <TextInput
              value={typed}
              onChangeText={(t) => { setTyped(t); setError(null); }}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
              placeholderTextColor={T.faint}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              style={styles.input}
              testID="devices-code-input"
            />
            <Pressable onPress={join} style={styles.button} testID="devices-join">
              <Text style={styles.buttonText}>Pair with that device</Text>
            </Pressable>
          </View>

          {paired && (
            <Pressable onPress={forget} style={styles.unpair} testID="devices-unpair">
              <Text style={styles.unpairText}>Unpair this device</Text>
            </Pressable>
          )}

          <Text style={styles.footnote}>
            Transactions travel straight between your devices over this
            network, encrypted with the pairing code. Nothing is sent to a
            server and nothing is stored anywhere else.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** What is true right now, in words rather than a tick. */
function Status({ paired, peers }: { paired: boolean; peers: number }) {
  const [line, detail] = !paired
    ? ['Not paired', 'This device keeps its own ledger and shares it with nothing.']
    : peers > 0
      ? [
          `Connected to ${peers} ${peers === 1 ? 'device' : 'devices'}`,
          'Changes on either device reach the other within a second.',
        ]
      : [
          'Paired, nothing connected',
          'Both devices have to be awake, on this network, with AcctMind open.',
        ];

  return (
    <View style={styles.status} testID="devices-status">
      <Text style={[styles.statusLine, peers > 0 && styles.statusLive]} testID="devices-status-line">
        {line}
      </Text>
      <Text style={styles.hint}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: T.bg },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm,
  },
  title: { color: T.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  // Drawn at TAP rather than padded up to it: hitSlop is a no-op on the web.
  barBtn: { minHeight: TAP, minWidth: TAP, justifyContent: 'center', alignItems: 'flex-end' },
  barBtnText: { color: T.accent, fontSize: 17 },
  body: { padding: SPACE.lg, gap: SPACE.lg, paddingBottom: SPACE.xl },
  status: { gap: SPACE.xs },
  statusLine: { color: T.text, fontSize: 17, fontWeight: '600' },
  statusLive: { color: T.positive },
  label: { color: T.dim, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
  hint: { color: T.dim, fontSize: 14, lineHeight: 20 },
  codeBox: {
    backgroundColor: T.card, borderRadius: 12, padding: SPACE.lg, gap: SPACE.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  code: {
    color: T.text, fontSize: 20, fontWeight: '600', letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  // Drawn at TAP, like every control here: hitSlop is a no-op on the web.
  copyBtn: {
    minHeight: TAP, justifyContent: 'center', alignItems: 'center',
    borderRadius: 10, backgroundColor: T.field,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  copyText: { color: T.accent, fontSize: 16, fontWeight: '600' },
  joinBox: { gap: SPACE.sm },
  input: {
    minHeight: TAP, backgroundColor: T.field, borderRadius: 10, color: T.text,
    paddingHorizontal: SPACE.md, fontSize: 17,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  button: {
    minHeight: TAP, justifyContent: 'center', alignItems: 'center',
    borderRadius: 10, backgroundColor: T.card, paddingHorizontal: SPACE.lg,
  },
  buttonText: { color: T.text, fontSize: 16, fontWeight: '600' },
  unpair: { minHeight: TAP, justifyContent: 'center', alignItems: 'center' },
  unpairText: { color: T.danger, fontSize: 16 },
  error: { color: T.danger, fontSize: 15 },
  ok: { color: T.positive, fontSize: 15 },
  footnote: { color: T.faint, fontSize: 13, lineHeight: 19 },
});
