import { useEffect } from "react";
import {
  changeBoothPin,
  clearHistory,
  dismissAlert,
  dualEnd,
  guestCancel,
  guestDefaultLang,
  guestRequest,
  initController,
  loadDualPrefill,
  masterRespond,
  masterStart,
  masterStop,
  pressDualTalk,
  pressTalk,
  replay,
  setSheetOpen,
  startSession,
  stopSession,
  submitPin,
  updateSettings,
} from "./state/controller";
import { useStore } from "./state/store";
import {
  AppShell,
  Banner,
  DUAL_LANGS,
  DualLayout,
  ENGINE_SHORT,
  FacingLayout,
  GuestEntry,
  GuestWaiting,
  Header,
  MasterSetup,
  MasterWaiting,
  OneHandLayout,
  PinScreen,
  SessionBar,
  SettingsSheet,
  dualStringsFor,
} from "./ui";
import { Demo } from "./ui/Demo";

const isDemo = new URLSearchParams(window.location.search).get("demo") === "1";

export default function App() {
  return isDemo ? <Demo /> : <InterpreterApp />;
}

function InterpreterApp() {
  useEffect(() => initController(), []);
  const s = useStore();
  const { settings } = s;
  const offline = !s.online || s.status === "offline";
  // No session means no engine: the dot shows idle whatever the last engine status or the network says.
  const status = s.sessionActive ? (offline ? "offline" : s.status) : "idle";
  const sessionStartedAt = s.sessionActive ? s.sessionStartedAt : null;

  const header = (
    <Header
      partnerLang={settings.partnerLang}
      onPartnerLangChange={(partnerLang) => updateSettings({ partnerLang })}
      status={status}
      mode={settings.mode}
      onToggleMode={() => updateSettings({ mode: settings.mode === "onehand" ? "facing" : "onehand" })}
      onOpenSettings={() => setSheetOpen(true)}
      langLocked={s.recording !== null}
    />
  );
  const banner = offline ? (
    <Banner kind="offline" />
  ) : s.alert ? (
    <Banner kind={s.alert.kind} message={s.alert.message} onDismiss={dismissAlert} />
  ) : s.status === "reconnecting" ? (
    <Banner kind="reconnecting" />
  ) : null;

  const sessionBar =
    sessionStartedAt !== null ? (
      <SessionBar status={status} engineName={s.mock ? "mock" : ENGINE_SHORT[settings.engine]} startedAt={sessionStartedAt} onStop={stopSession} />
    ) : null;

  const layout = {
    header,
    sessionBar,
    banner,
    messages: s.messages,
    partnerLang: settings.partnerLang,
    recording: s.recording,
    playingId: s.playingId,
    onReplay: replay,
    onPtt: pressTalk,
    sessionActive: s.sessionActive,
    engineReady: s.status === "ready",
    onStartSession: startSession,
  };

  const dual = s.dual;
  const guestUrl = `${window.location.origin}/guest`;
  const pairedLayout = (myLabel: string, partnerLabel: string, onOpenSettings?: () => void) =>
    dual.myLang && dual.partner ? (
      <DualLayout
        myLang={dual.myLang}
        myLabel={myLabel}
        partner={dual.partner}
        partnerLabel={partnerLabel}
        messages={s.dualMessages}
        recording={s.recording}
        engineReady={s.status === "ready"}
        status={status}
        banner={banner}
        onTalk={pressDualTalk}
        onEnd={dualEnd}
        onOpenSettings={onOpenSettings}
      />
    ) : null;

  const guestScreen = () => {
    const t = dualStringsFor(dual.myLang ?? guestDefaultLang());
    if (dual.phase === "paired") return pairedLayout(t.guestNumber(dual.guestId ?? ""), t.booth);
    if (dual.phase === "requesting" && dual.myLang) return <GuestWaiting myLang={dual.myLang} onCancel={guestCancel} />;
    const langs = DUAL_LANGS.filter((l) => l !== dual.masterLang);
    const preferred = dual.myLang ?? guestDefaultLang();
    return (
      <GuestEntry
        boothPin={dual.boothPin}
        masterOnline={dual.masterOnline}
        langs={langs}
        initialLang={langs.includes(preferred) ? preferred : langs[0]}
        busy={false}
        notice={dual.notice}
        onRequest={(pin, lang) => void guestRequest(pin, lang)}
      />
    );
  };

  const masterScreen = () => {
    const t = dualStringsFor(dual.myLang ?? "ko");
    const openSettings = () => setSheetOpen(true);
    if (dual.phase === "paired") return pairedLayout(t.booth, t.guestNumber(dual.partner?.id ?? ""), openSettings);
    if (dual.phase === "waiting" && dual.myLang) {
      return (
        <MasterWaiting
          myLang={dual.myLang}
          boothPin={dual.boothPin}
          guestUrl={guestUrl}
          requests={dual.requests}
          notice={dual.notice}
          onAccept={(id) => masterRespond(id, true)}
          onDecline={(id) => masterRespond(id, false)}
          onStop={masterStop}
          onOpenSettings={openSettings}
        />
      );
    }
    return (
      <MasterSetup
        initialLang={loadDualPrefill().lang}
        busy={dual.phase === "joining"}
        notice={dual.notice}
        onStart={(lang) => void masterStart(lang)}
        onBasicMode={() => updateSettings({ appMode: "basic" })}
        onOpenSettings={openSettings}
      />
    );
  };

  if (dual.role === "guest") {
    return (
      <AppShell theme={settings.theme} fontScale={settings.fontScale} recording={s.recording !== null}>
        {guestScreen()}
        {s.mock && (
          <div
            data-testid="mock-badge"
            className="pointer-events-none fixed top-0 left-1/2 z-300 -translate-x-1/2 rounded-b bg-yellow-300 px-1.5 text-[10px] font-black text-black"
          >
            MOCK
          </div>
        )}
      </AppShell>
    );
  }

  return (
    <AppShell theme={settings.theme} fontScale={settings.fontScale} recording={s.recording !== null}>
      {!s.pin ? (
        <PinScreen onSubmit={(pin) => void submitPin(pin)} error={s.pinError} busy={s.pinBusy} />
      ) : settings.appMode === "dual" ? (
        masterScreen()
      ) : settings.mode === "onehand" ? (
        <OneHandLayout {...layout} />
      ) : (
        <FacingLayout {...layout} />
      )}
      <SettingsSheet
        open={s.sheetOpen && s.pin !== null}
        settings={{
          engine: settings.engine,
          fontScale: settings.fontScale,
          theme: settings.theme,
          micDeviceId: settings.micDeviceId,
        }}
        appMode={settings.appMode}
        onAppModeChange={(appMode) => updateSettings({ appMode })}
        boothPin={settings.appMode === "dual" ? dual.boothPin : undefined}
        guestUrl={settings.appMode === "dual" ? guestUrl : undefined}
        onBoothPinChange={settings.appMode === "dual" ? changeBoothPin : undefined}
        micDevices={s.micDevices}
        onChange={updateSettings}
        onClearHistory={clearHistory}
        onClose={() => setSheetOpen(false)}
      />
      {s.mock && (
        <div
          data-testid="mock-badge"
          className="pointer-events-none fixed top-0 left-1/2 z-300 -translate-x-1/2 rounded-b bg-yellow-300 px-1.5 text-[10px] font-black text-black"
        >
          MOCK
        </div>
      )}
    </AppShell>
  );
}
