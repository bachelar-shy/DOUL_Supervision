import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Crypto from "expo-crypto";
import { ApiClient, ApiError, configureKeyFactory } from "@doul/client";
import type {
  HumanRole,
  Workspace,
  WorkItem,
  CommandDescriptor,
  Fields,
} from "@doul/client";
import { captureOriginal, listCaptures, submitCapture } from "./src/capture";
import type { SavedCapture } from "./src/capture";
import type { TranslationKey } from "@doul/localization";
import {
  appLanguages,
  changeMobileLanguage,
  type AppLanguage,
} from "./src/i18n";

configureKeyFactory(Crypto.randomUUID);
const api = new ApiClient("http://127.0.0.1:8791");
const commandKeys: Record<string, TranslationKey> = {
  request: "command.request",
  receive: "command.receive",
  schedule: "command.schedule",
  start: "command.start",
  submit_results: "command.submit_results",
  pass: "command.pass",
  fail: "command.fail",
  release_next_work: "command.release_next_work",
  begin_review: "command.begin_review",
  confirm: "command.confirm",
  reject: "command.reject",
  submit: "command.submit",
  verify: "command.verify",
  close: "command.close",
  acknowledge: "command.acknowledge",
  decide: "command.decide",
  start_correction: "command.start_correction",
  request_reinspection: "command.request_reinspection",
  start_reinspection: "command.start_reinspection",
  reject_reinspection: "command.reject_reinspection",
  issue: "command.issue",
  answer: "command.answer",
};
const stateKeys: Record<string, TranslationKey> = {
  scheduled: "state.scheduled",
  requested: "state.requested",
  passed: "state.passed",
  completed: "state.completed",
  in_progress: "state.in_progress",
  candidate: "state.candidate",
  under_review: "state.under_review",
  confirmed: "state.confirmed",
  assigned: "state.assigned",
  issued: "state.issued",
  reported: "state.reported",
  awaiting_decision: "state.awaiting_decision",
  closed: "state.closed",
  ready_for_recheck: "state.ready_for_recheck",
  reinspection: "state.reinspection",
};
const label = (item: WorkItem) =>
  item.record.title ||
  item.record.workName ||
  item.record.description ||
  String(item.record.metadata?.name || item.record.id.slice(0, 8));

export default function App() {
  const { t, i18n } = useTranslation();
  const roleLabel = (value: HumanRole) => t(`roles.${value}`);
  const commandLabel = (value: string) => {
    const key = commandKeys[value];
    return key ? t(key) : value;
  };
  const stateLabel = (value?: string | null) => {
    if (!value) return "";
    const key = stateKeys[value];
    return key ? t(key) : value;
  };
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [role, setRole] = useState<HumanRole>("SUP");
  const [tab, setTab] = useState("today");
  const [selection, setSelection] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [endpoint, setEndpoint] = useState(api.baseUrl);
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState<SavedCapture[]>([]);
  const [modal, setModal] = useState<{
    item: WorkItem;
    action: CommandDescriptor;
  } | null>(null);
  const [payload, setPayload] = useState("{}");
  const { width } = useWindowDimensions();
  const tablet = width >= 760;
  async function refresh() {
    setBusy(true);
    try {
      const w = await api.workspace();
      setWorkspace(w);
      setOnline(true);
      setPending(await listCaptures(w.project.id, api.session!.actor.partyId));
      setMessage(t("mobile.status.fetchComplete"));
    } catch (e) {
      setOnline(false);
      setMessage(e instanceof Error ? e.message : t("app.error.connection"));
    } finally {
      setBusy(false);
    }
  }
  async function login(r: HumanRole) {
    setBusy(true);
    setWorkspace(null);
    setSelection(null);
    try {
      api.baseUrl = endpoint;
      await api.login(r);
      setRole(r);
      await refresh();
    } catch (e) {
      setOnline(false);
      setMessage(t("mobile.status.apiFailure", { error: String(e) }));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void login("SUP");
  }, []);
  const items = workspace?.items || [];
  const selected = items.find((x) => x.record.id === selection);
  const visible = items.filter((x) =>
    tab === "today"
      ? role === "OWN"
        ? ["report", "decision"].includes(x.machine)
        : role === "DES"
          ? x.machine === "rfi"
          : ["inspection", "action"].includes(x.machine)
      : tab === "inspections"
        ? x.machine === "inspection"
        : tab === "issues"
          ? ["issue", "action", "observation"].includes(x.machine)
          : ["report", "decision", "rfi"].includes(x.machine),
  );
  async function capture(library = false) {
    if (!workspace || !api.session) return;
    try {
      setBusy(true);
      const r = await captureOriginal(
        workspace.project.id,
        api.session.actor.partyId,
        library,
      );
      if (r) setMessage(t("mobile.status.captureSaved"));
      setPending(
        await listCaptures(workspace.project.id, api.session.actor.partyId),
      );
    } catch (e) {
      Alert.alert(t("mobile.alert.capture"), String(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(c: SavedCapture) {
    if (!workspace) return;
    setBusy(true);
    try {
      await submitCapture(api, c, workspace.context.scope, (offset, total) =>
        setMessage(
          t("mobile.status.transfer", {
            percent: Math.round((offset / total) * 100),
          }),
        ),
      );
      await refresh();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  function openCommand(item: WorkItem, action: CommandDescriptor) {
    const initial: Fields = {};
    for (const f of action.fields) {
      if (f.endsWith("At")) initial[f] = new Date().toISOString();
      else if (f === "checkResults")
        initial[f] = [
          {
            itemId: "dimension",
            requirementRef: workspace!.context
              .requirementRef as unknown as Fields,
            result: "pass",
            evidenceIds: item.record.evidenceIds || [],
            measuredValue: 120,
            unit: "mm",
          },
        ];
      else if (f === "changeRequired") initial[f] = false;
      else if (
        f.endsWith("Ids") ||
        f.endsWith("Refs") ||
        f === "verificationGrounding"
      )
        initial[f] = [];
      else initial[f] = "";
    }
    setPayload(JSON.stringify(initial, null, 2));
    setModal({ item, action });
  }
  async function execute() {
    if (!modal) return;
    try {
      setBusy(true);
      await api.execute(
        modal.item,
        modal.action.command,
        JSON.parse(payload) as Fields,
      );
      setModal(null);
      await refresh();
    } catch (e) {
      Alert.alert(
        e instanceof ApiError && e.detail.code === "VERSION_CONFLICT"
          ? t("mobile.error.versionConflict")
          : t("mobile.error.serverRejected"),
        String(e),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <View>
          <Text style={s.brand}>
            DOUL / <Text style={s.brandSub}>SUPERVISION</Text>
          </Text>
          <Text style={s.sub}>
            {t("app.sampleSite")} · {t("app.sampleData")}
          </Text>
        </View>
        <Text style={[s.network, !online && s.warning]}>
          {online ? t("app.connection.online") : t("mobile.connectionCheck")}
        </Text>
      </View>
      <View style={s.demo}>
        <Text style={s.demoText}>{t("mobile.devBanner")}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.languages}
        contentContainerStyle={s.rolesContent}
      >
        {appLanguages.map((language) => {
          const active = (i18n.resolvedLanguage ?? i18n.language) === language.code;
          return (
            <Pressable
              key={language.code}
              accessibilityRole="button"
              accessibilityLabel={language.nativeName}
              onPress={() =>
                void changeMobileLanguage(language.code as AppLanguage)
              }
              style={[s.language, active && s.languageActive]}
            >
              <Text
                style={[
                  s.languageText,
                  active && s.languageTextActive,
                ]}
              >
                {language.nativeName}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.roles}
        contentContainerStyle={s.rolesContent}
      >
        {(["SUP", "CON", "OWN", "DES", "ADM"] as HumanRole[]).map((r) => (
          <Pressable
            key={r}
            accessibilityRole="button"
            onPress={() => void login(r)}
            style={[s.role, role === r && s.roleActive]}
          >
            <Text style={[s.roleText, role === r && s.roleTextActive]}>
              {roleLabel(r)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={s.status}>
        <Text style={s.statusText}>{message}</Text>
        <Pressable onPress={() => void refresh()} disabled={busy}>
          <Text style={s.link}>{t("mobile.refresh")}</Text>
        </Pressable>
      </View>
      <View style={[s.content, tablet && s.tablet]}>
        <ScrollView
          style={[s.list, tablet && { maxWidth: 420 }]}
          contentContainerStyle={s.padding}
        >
          <Text style={s.eyebrow}>
            {t("mobile.roleWorkspace", { role: roleLabel(role) })}
          </Text>
          <Text style={s.title}>
            {tab === "today"
              ? t("navigation.today")
              : tab === "capture"
                ? t("mobile.captureTitle")
                : tab === "inspections"
                  ? t("mobile.inspectionTitle")
                  : tab === "issues"
                    ? t("mobile.issueActionTitle")
                    : t("mobile.moreTitle")}
          </Text>
          {tab === "today" && (
            <View style={s.metrics}>
              {[
                [
                  t("mobile.metric.inspections"),
                  items.filter((x) => x.machine === "inspection").length,
                ],
                [
                  t("mobile.metric.openIssues"),
                  items.filter(
                    (x) =>
                      x.machine === "issue" && x.record.status !== "closed",
                  ).length,
                ],
              ].map(([k, v]) => (
                <View style={s.metric} key={String(k)}>
                  <Text style={s.sub}>{k}</Text>
                  <Text style={s.number}>
                    {v}
                    <Text style={s.sub}>
                      {" "}{t("mobile.unit.count", { count: "" }).trim()}
                    </Text>
                  </Text>
                </View>
              ))}
            </View>
          )}
          {tab === "capture" ? (
            <>
              <View style={s.card}>
                <Text style={s.cardTitle}>
                  {t("mobile.capture.recordOriginal")}
                </Text>
                <Text style={s.help}>{t("mobile.capture.help")}</Text>
                <Button
                  title={t("mobile.capture.camera")}
                  onPress={() => void capture()}
                  disabled={busy || !workspace}
                />
                <Button
                  title={t("mobile.capture.import")}
                  onPress={() => void capture(true)}
                  disabled={busy || !workspace}
                  secondary
                />
              </View>
              <Text style={s.section}>{t("mobile.capture.deviceStore")}</Text>
              {pending.map((c) => (
                <View style={s.card} key={c.id}>
                  <Text style={s.cardTitle}>{c.name}</Text>
                  <Text style={s.help}>
                    {c.status === "uploaded"
                      ? t("mobile.capture.uploaded")
                      : t("mobile.capture.pending")}
                    {"\n"}SHA256 {c.hash.slice(0, 16)}…
                  </Text>
                  <Button
                    title={t("mobile.capture.upload")}
                    disabled={busy || !online || c.status === "uploaded"}
                    onPress={() => void upload(c)}
                  />
                </View>
              ))}
            </>
          ) : (
            <>
              {visible.map((item) => (
                <Pressable
                  key={item.record.id}
                  style={[s.card, selection === item.record.id && s.selected]}
                  onPress={() => setSelection(item.record.id)}
                >
                  <View style={s.row}>
                    <Text style={s.code}>
                      {item.record.id.slice(0, 8)} · v{item.record.version}
                    </Text>
                    <Text style={s.badge}>
                      {stateLabel(item.record.status)}
                    </Text>
                  </View>
                  <Text style={s.cardTitle}>{label(item)}</Text>
                  <Text style={s.help}>{t("mobile.sampleLocation")}</Text>
                </Pressable>
              ))}
              {!visible.length && (
                <Text style={s.help}>{t("mobile.empty")}</Text>
              )}
            </>
          )}
          {tab === "more" && (
            <View style={s.card}>
              <Text style={s.cardTitle}>{t("mobile.settings.title")}</Text>
              <Text style={s.help}>{t("mobile.settings.help")}</Text>
              <TextInput
                style={s.input}
                value={endpoint}
                onChangeText={setEndpoint}
                autoCapitalize="none"
                accessibilityLabel={t("mobile.settings.apiAria")}
              />
              <Button
                title={t("mobile.settings.reconnect")}
                onPress={() => void login(role)}
              />
              <Text style={s.help}>{t("mobile.settings.webOnly")}</Text>
            </View>
          )}
        </ScrollView>
        {selected && tab !== "capture" && (
          <View style={tablet ? s.detailTablet : s.detailPhone}>
            <ScrollView contentContainerStyle={s.padding}>
              <Pressable onPress={() => setSelection(null)}>
                <Text style={s.link}>{t("mobile.back")}</Text>
              </Pressable>
              <Text style={s.title}>{label(selected)}</Text>
              <Text style={s.badge}>
                {stateLabel(selected.record.status)}{" "}
                · v{selected.record.version}
              </Text>
              <View style={s.notice}>
                <Text style={s.help}>
                  {selected.machine === "inspection"
                    ? [
                        t("mobile.inspection.result", {
                          result:
                            selected.record.resultStatus ||
                            t("mobile.inspection.unjudged"),
                        }),
                        t("mobile.inspection.holdCheck", {
                          value: selected.record.holdPoint
                            ? t("mobile.inspection.hold")
                            : t("mobile.inspection.normal"),
                        }),
                        t("mobile.inspection.nextWork", {
                          value: selected.record.nextWorkAllowed
                            ? t("mobile.inspection.allowed")
                            : t("mobile.inspection.notAllowed"),
                        }),
                      ].join("\n")
                    : t("mobile.permissionHelp")}
                </Text>
              </View>
              <Text style={s.section}>{t("mobile.availableActions")}</Text>
              {selected.actions.map((a) => (
                <View key={a.command}>
                  <Button
                    title={commandLabel(a.command)}
                    disabled={busy || !online || (!a.ready && !a.requiresInput)}
                    onPress={() => openCommand(selected, a)}
                  />
                  {a.blockedReason && !a.requiresInput && (
                    <Text style={s.help}>
                      {t("mobile.prerequisite", {
                        code: a.blockedReason.code,
                      })}
                    </Text>
                  )}
                </View>
              ))}
              <Text style={s.help}>
                {t("mobile.evidenceCount", {
                  count: selected.record.evidenceIds?.length || 0,
                })}
              </Text>
            </ScrollView>
          </View>
        )}
      </View>
      <View style={s.nav}>
        {(
          [
            ["today", "navigation.today"],
            ["inspections", "mobile.inspections"],
            ["capture", "mobile.capture"],
            ["issues", "mobile.issues"],
            ["more", "mobile.nav.more"],
          ] as Array<[string, TranslationKey]>
        ).map(([id, labelKey]) => (
          <Pressable
            key={id}
            style={s.navButton}
            onPress={() => {
              setTab(id);
              setSelection(null);
            }}
          >
            <Text style={[s.navLabel, tab === id && s.navActive]}>
              {t(labelKey)}
            </Text>
          </Pressable>
        ))}
      </View>
      <Modal
        visible={!!modal}
        animationType="slide"
        onRequestClose={() => setModal(null)}
      >
        <SafeAreaView style={s.safe}>
          <ScrollView contentContainerStyle={s.padding}>
            <Text style={s.title}>
              {modal ? commandLabel(modal.action.command) : ""}
            </Text>
            <Text style={s.help}>
              {t("mobile.modal.help", {
                version: modal?.item.record.version ?? "",
              })}
            </Text>
            <TextInput
              style={[s.input, s.payload]}
              value={payload}
              onChangeText={setPayload}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={t("mobile.modal.payloadAria")}
            />
            <Button
              title={t("mobile.modal.execute")}
              disabled={busy}
              onPress={() => void execute()}
            />
            <Button
              title={t("mobile.cancel")}
              secondary
              onPress={() => setModal(null)}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, disabled && { opacity: 0.4 }]}
    >
      <Text style={[s.buttonText, secondary && { color: "#17365D" }]}>
        {title}
      </Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f5f6f8" },
  header: {
    padding: 20,
    backgroundColor: "white",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderColor: "#e3e8ee",
  },
  brand: { fontSize: 22, fontWeight: "700", color: "#17365D" },
  brandSub: { fontSize: 10, letterSpacing: 2 },
  sub: { fontSize: 11, color: "#8896a5", marginTop: 5 },
  network: { fontSize: 10, color: "#668b73" },
  warning: { color: "#ab7842" },
  demo: { backgroundColor: "#eaf0f6", padding: 8 },
  demoText: { fontSize: 9, textAlign: "center", color: "#7b8da1" },
  languages: {
    flexGrow: 0,
    maxHeight: 46,
    backgroundColor: "#f8fafc",
    borderBottomWidth: 1,
    borderColor: "#e3e8ee",
  },
  language: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#d9e0e7",
    backgroundColor: "white",
  },
  languageActive: { borderColor: "#17365D", backgroundColor: "#edf3f9" },
  languageText: { fontSize: 10, color: "#7e8c9d" },
  languageTextActive: { color: "#17365D", fontWeight: "600" },
  roles: { flexGrow: 0, maxHeight: 52, backgroundColor: "white" },
  rolesContent: { paddingHorizontal: 15, paddingVertical: 10, gap: 8 },
  role: {
    paddingVertical: 8,
    paddingHorizontal: 17,
    borderRadius: 4,
    backgroundColor: "#f2f4f7",
  },
  roleActive: { backgroundColor: "#17365D" },
  roleText: { fontSize: 11, color: "#7e8c9d" },
  roleTextActive: { color: "white" },
  status: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 12,
  },
  statusText: { fontSize: 9, color: "#91a0b1", flex: 1 },
  link: { fontSize: 11, color: "#305b8c", paddingVertical: 6 },
  content: { flex: 1 },
  tablet: { flexDirection: "row" },
  list: { flex: 1 },
  padding: { padding: 20, paddingBottom: 40 },
  eyebrow: { fontSize: 10, color: "#8595a8", marginBottom: 9 },
  title: {
    fontSize: 23,
    fontWeight: "600",
    color: "#243b56",
    marginBottom: 22,
    marginTop: 8,
    lineHeight: 34,
  },
  metrics: { flexDirection: "row", gap: 12, marginBottom: 20 },
  metric: {
    flex: 1,
    padding: 18,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e0e6ed",
    borderRadius: 5,
  },
  number: { fontSize: 31, color: "#284869", marginTop: 12 },
  card: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e0e6ed",
    borderRadius: 5,
    padding: 17,
    marginBottom: 12,
  },
  selected: { borderColor: "#7496bc", backgroundColor: "#f2f6fc" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  code: { fontSize: 9, color: "#9aa8b7" },
  badge: {
    fontSize: 10,
    color: "#7088a3",
    backgroundColor: "#edf2f7",
    padding: 5,
    alignSelf: "flex-start",
    borderRadius: 3,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#3b526e",
    lineHeight: 22,
    marginTop: 10,
  },
  help: { fontSize: 11, color: "#8b9bae", lineHeight: 20, marginVertical: 9 },
  section: {
    fontSize: 14,
    fontWeight: "600",
    color: "#45617f",
    marginVertical: 20,
  },
  button: {
    backgroundColor: "#17365D",
    minHeight: 46,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    padding: 12,
  },
  buttonText: { fontSize: 12, color: "white", fontWeight: "600" },
  secondary: {
    backgroundColor: "#f3f6fa",
    borderWidth: 1,
    borderColor: "#d8e2ed",
  },
  nav: {
    flexDirection: "row",
    backgroundColor: "white",
    borderTopWidth: 1,
    borderColor: "#dce4ed",
    minHeight: 60,
  },
  navButton: {
    flex: 1,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  navLabel: { fontSize: 11, color: "#99a8b8" },
  navActive: { fontWeight: "700", color: "#17365D" },
  detailTablet: {
    flex: 1,
    backgroundColor: "white",
    borderLeftWidth: 1,
    borderColor: "#dfe7ef",
  },
  detailPhone: { position: "absolute", inset: 0, backgroundColor: "#fff" },
  notice: {
    backgroundColor: "#f2f5f9",
    padding: 15,
    borderLeftWidth: 2,
    borderColor: "#93adc9",
    marginVertical: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: "#c9d7e6",
    padding: 13,
    borderRadius: 4,
    backgroundColor: "white",
    fontSize: 12,
    color: "#324d6c",
  },
  payload: {
    minHeight: 230,
    textAlignVertical: "top",
    fontFamily: "monospace",
    marginVertical: 20,
  },
});
