import { useEffect, useState } from "react";
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

configureKeyFactory(Crypto.randomUUID);
const api = new ApiClient("http://127.0.0.1:8791");
const roleNames: Record<HumanRole, string> = {
  SUP: "감리",
  CON: "시공사",
  OWN: "발주처",
  DES: "설계자",
  ADM: "관리자",
};
const commandNames: Record<string, string> = {
  request: "검측 요청",
  receive: "접수",
  schedule: "일정 배정",
  start: "시작",
  submit_results: "결과 제출",
  pass: "적합 판정",
  fail: "부적합 판정",
  release_next_work: "후속공정 허용",
  begin_review: "관찰 검토",
  confirm: "관찰 확인",
  reject: "관찰 제외",
  submit: "시정자료 제출",
  verify: "조치 검증",
  close: "종결 검토",
  acknowledge: "수령 확인",
  decide: "결정 제출",
  start_correction: "시정 시작",
  request_reinspection: "재검측 요청",
  start_reinspection: "재검측 시작",
  reject_reinspection: "재시정 요청",
  issue: "공식 발행",
  answer: "설계 답변",
};
const stateNames: Record<string, string> = {
  scheduled: "검측 예정",
  requested: "접수 대기",
  passed: "적합 · 승인 전",
  completed: "검측 완료",
  in_progress: "진행 중",
  candidate: "관찰 후보",
  under_review: "확인 중",
  confirmed: "관찰 확인",
  assigned: "배정됨",
  issued: "발행 · 수령대기",
  reported: "결정 요청",
  awaiting_decision: "결정 대기",
  closed: "종결",
  ready_for_recheck: "재검측 대기",
  reinspection: "재검측 중",
};
const label = (item: WorkItem) =>
  item.record.title ||
  item.record.workName ||
  item.record.description ||
  String(item.record.metadata?.name || item.record.id.slice(0, 8));

export default function App() {
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
      setMessage("서버 조회 완료");
    } catch (e) {
      setOnline(false);
      setMessage(e instanceof Error ? e.message : "연결 오류");
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
      setMessage("개발 API 연결 실패: " + String(e));
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
      if (r) setMessage("원본 기기 저장 완료 · 아직 제출되지 않음");
      setPending(
        await listCaptures(workspace.project.id, api.session.actor.partyId),
      );
    } catch (e) {
      Alert.alert("촬영·저장 확인", String(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(c: SavedCapture) {
    if (!workspace) return;
    setBusy(true);
    try {
      await submitCapture(api, c, workspace.context.scope, (o, t) =>
        setMessage("전송 " + Math.round((o / t) * 100) + "%"),
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
          ? "버전 충돌 · 덮어쓰지 않습니다."
          : "서버에서 처리되지 않았습니다.",
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
          <Text style={s.sub}>시범현장 · 예시 데이터</Text>
        </View>
        <Text style={[s.network, !online && s.warning]}>
          {online ? "온라인" : "연결 확인 필요"}
        </Text>
      </View>
      <View style={s.demo}>
        <Text style={s.demoText}>
          개발용 · 실제 승인/법정 서명/AI 분석 아님
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.roles}
        contentContainerStyle={s.rolesContent}
      >
        {(Object.keys(roleNames) as HumanRole[]).map((r) => (
          <Pressable
            key={r}
            accessibilityRole="button"
            onPress={() => void login(r)}
            style={[s.role, role === r && s.roleActive]}
          >
            <Text style={[s.roleText, role === r && s.roleTextActive]}>
              {roleNames[r]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={s.status}>
        <Text style={s.statusText}>{message}</Text>
        <Pressable onPress={() => void refresh()} disabled={busy}>
          <Text style={s.link}>새로고침</Text>
        </Pressable>
      </View>
      <View style={[s.content, tablet && s.tablet]}>
        <ScrollView
          style={[s.list, tablet && { maxWidth: 420 }]}
          contentContainerStyle={s.padding}
        >
          <Text style={s.eyebrow}>{roleNames[role]} 작업공간</Text>
          <Text style={s.title}>
            {tab === "today"
              ? "오늘"
              : tab === "capture"
                ? "현장 촬영"
                : tab === "inspections"
                  ? "검측·검수"
                  : tab === "issues"
                    ? "이슈·조치"
                    : "보고·설정"}
          </Text>
          {tab === "today" && (
            <View style={s.metrics}>
              {[
                [
                  "검측",
                  items.filter((x) => x.machine === "inspection").length,
                ],
                [
                  "미종결 이슈",
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
                    <Text style={s.sub}> 건</Text>
                  </Text>
                </View>
              ))}
            </View>
          )}
          {tab === "capture" ? (
            <>
              <View style={s.card}>
                <Text style={s.cardTitle}>사진을 원본으로 기록합니다.</Text>
                <Text style={s.help}>
                  위치: A동 2층 / C-5 (수동 지정). AR·QR·Depth는 아직 연결하지
                  않았습니다.
                </Text>
                <Button
                  title="카메라 촬영"
                  onPress={() => void capture()}
                  disabled={busy || !workspace}
                />
                <Button
                  title="사진·영상 가져오기"
                  onPress={() => void capture(true)}
                  disabled={busy || !workspace}
                  secondary
                />
              </View>
              <Text style={s.section}>기기 원본 저장소</Text>
              {pending.map((c) => (
                <View style={s.card} key={c.id}>
                  <Text style={s.cardTitle}>{c.name}</Text>
                  <Text style={s.help}>
                    {c.status === "uploaded"
                      ? "서버 등록 완료 · 기기 원본 유지"
                      : "기기 저장 · 제출 대기"}
                    {"\n"}SHA256 {c.hash.slice(0, 16)}…
                  </Text>
                  <Button
                    title="서버 전송"
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
                      {stateNames[item.record.status || ""] ||
                        item.record.status}
                    </Text>
                  </View>
                  <Text style={s.cardTitle}>{label(item)}</Text>
                  <Text style={s.help}>A동 2층 / C-5 →</Text>
                </Pressable>
              ))}
              {!visible.length && (
                <Text style={s.help}>조회할 항목이 없습니다.</Text>
              )}
            </>
          )}
          {tab === "more" && (
            <View style={s.card}>
              <Text style={s.cardTitle}>개발 연결 설정</Text>
              <Text style={s.help}>
                iOS 시뮬레이터 또는 adb reverse 연결용입니다. 이 API는 사내 운영
                인증을 제공하지 않습니다.
              </Text>
              <TextInput
                style={s.input}
                value={endpoint}
                onChangeText={setEndpoint}
                autoCapitalize="none"
                accessibilityLabel="개발 API 주소"
              />
              <Button title="다시 연결" onPress={() => void login(role)} />
              <Text style={s.help}>
                문서 편집·권한관리의 전체 화면은 반응형 웹에서 사용합니다.
              </Text>
            </View>
          )}
        </ScrollView>
        {selected && tab !== "capture" && (
          <View style={tablet ? s.detailTablet : s.detailPhone}>
            <ScrollView contentContainerStyle={s.padding}>
              <Pressable onPress={() => setSelection(null)}>
                <Text style={s.link}>← 목록으로</Text>
              </Pressable>
              <Text style={s.title}>{label(selected)}</Text>
              <Text style={s.badge}>
                {stateNames[selected.record.status || ""] ||
                  selected.record.status}{" "}
                · v{selected.record.version}
              </Text>
              <View style={s.notice}>
                <Text style={s.help}>
                  {selected.machine === "inspection"
                    ? `판정: ${selected.record.resultStatus || "미판정"}\n필수확인: ${selected.record.holdPoint ? "Hold 적용" : "일반"}\n후속공정: ${selected.record.nextWorkAllowed ? "허용" : "미허용 · 서명/승인 확인"}`
                    : "현재 역할에 허용된 명령만 표시합니다. 시공사는 이슈를 종결할 수 없습니다."}
                </Text>
              </View>
              <Text style={s.section}>현재 가능한 업무</Text>
              {selected.actions.map((a) => (
                <View key={a.command}>
                  <Button
                    title={commandNames[a.command] || a.command}
                    disabled={busy || !online || (!a.ready && !a.requiresInput)}
                    onPress={() => openCommand(selected, a)}
                  />
                  {a.blockedReason && !a.requiresInput && (
                    <Text style={s.help}>선행조건: {a.blockedReason.code}</Text>
                  )}
                </View>
              ))}
              <Text style={s.help}>
                증빙 {selected.record.evidenceIds?.length || 0}건 · 원본 버전을
                유지합니다.
              </Text>
            </ScrollView>
          </View>
        )}
      </View>
      <View style={s.nav}>
        {[
          ["today", "오늘"],
          ["inspections", "검측"],
          ["capture", "촬영"],
          ["issues", "이슈"],
          ["more", "더보기"],
        ].map(([id, t]) => (
          <Pressable
            key={id}
            style={s.navButton}
            onPress={() => {
              setTab(id);
              setSelection(null);
            }}
          >
            <Text style={[s.navLabel, tab === id && s.navActive]}>{t}</Text>
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
              {modal
                ? commandNames[modal.action.command] || modal.action.command
                : ""}
            </Text>
            <Text style={s.help}>
              현재는 개발용 구조화 입력입니다. 원본 v
              {modal?.item.record.version} 기준이며, 서버에서 최종 검증합니다.
            </Text>
            <TextInput
              style={[s.input, s.payload]}
              value={payload}
              onChangeText={setPayload}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="업무 명령 입력"
            />
            <Button
              title="확인 후 실행"
              disabled={busy}
              onPress={() => void execute()}
            />
            <Button title="취소" secondary onPress={() => setModal(null)} />
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
