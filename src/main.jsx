import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "./styles.css";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : window.location.origin);

const DEFAULT_KEYS = ["Q", "P", "Z", "M", "A", "L", "S", "K"];

function App() {
  const socket = useMemo(() => io(SERVER_URL, { transports: ["websocket", "polling"] }), []);
  const [role, setRole] = useState(null);
  const [room, setRoom] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("roomState", (state) => setRoom(state));

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("roomState");
      socket.close();
    };
  }, [socket]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get("room");
    const requestedRole = params.get("role");
    if (roomCode && requestedRole) {
      joinRoom(requestedRole === "host" ? "host" : "viewer", roomCode);
    }
  }, []);

  function createRoom() {
    setMessage("");
    socket.emit("createRoom", {}, (response) => {
      if (!response?.ok) {
        setMessage(response?.error || "방을 만들지 못했습니다.");
        return;
      }
      setRole("host");
      setRoom(response.state);
      updateAddress(response.state.code, "host");
    });
  }

  function joinRoom(nextRole = "viewer", code = joinCode) {
    const roomCode = code.trim().toUpperCase();
    if (!roomCode) {
      setMessage("방 코드를 입력해 주세요.");
      return;
    }
    setMessage("");
    socket.emit("joinRoom", { roomCode, role: nextRole }, (response) => {
      if (!response?.ok) {
        setMessage(response?.error || "방에 접속하지 못했습니다.");
        return;
      }
      setRole(nextRole);
      setRoom(response.state);
      updateAddress(response.state.code, nextRole);
    });
  }

  function updateAddress(roomCode, nextRole) {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomCode);
    url.searchParams.set("role", nextRole);
    window.history.replaceState({}, "", url);
  }

  if (!room || !role) {
    return (
      <StartScreen
        connected={connected}
        joinCode={joinCode}
        message={message}
        onCreate={createRoom}
        onJoin={() => joinRoom("viewer")}
        setJoinCode={setJoinCode}
      />
    );
  }

  return (
    <div className={`app-shell ${role === "viewer" ? "viewer-shell" : ""}`}>
      {role === "host" ? (
        <HostDashboard socket={socket} room={room} setMessage={setMessage} message={message} />
      ) : (
        <ViewerScreen socket={socket} room={room} setMessage={setMessage} message={message} />
      )}
    </div>
  );
}

function StartScreen({ connected, joinCode, message, onCreate, onJoin, setJoinCode }) {
  return (
    <main className="start-screen">
      <div className="start-nav">
        <strong>SPEED QUIZ</strong>
        <span>HOST 1 + VIEWER LAPTOP 1</span>
      </div>
      <section className="start-copy">
        <p className="eyebrow">BUZZER v1</p>
        <h1>스피드 퀴즈쇼</h1>
        <p>
          PPT를 이미지 슬라이드로 올리고, 한 대의 뷰어 노트북 키보드를 여러 참가자의 버저로
          나눠 쓰는 진행형 퀴즈 웹앱입니다.
        </p>
        <div className={`connection-pill ${connected ? "online" : ""}`}>
          {connected ? "실시간 서버 연결됨" : "실시간 서버 연결 대기 중"}
        </div>
      </section>

      <section className="start-actions blueprint-panel" aria-label="시작 선택">
        <button className="primary-action blueprint-button" onClick={onCreate}>방 만들기</button>
        <div className="join-box">
          <label htmlFor="room-code">방 코드</label>
          <div className="join-row">
            <input
              id="room-code"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") onJoin();
              }}
              placeholder="예: A1B2C3"
              maxLength={8}
            />
            <button onClick={onJoin}>참가</button>
          </div>
        </div>
        {message ? <p className="form-error">{message}</p> : null}
      </section>
    </main>
  );
}

function HostDashboard({ socket, room, message, setMessage }) {
  const currentSlide = room.slides[room.currentSlide];
  const activePlayer = room.activeBuzz
    ? room.players.find((player) => player.id === room.activeBuzz.playerId)
    : null;

  function emit(event, payload = {}) {
    socket.emit(event, { roomCode: room.code, ...payload }, (response) => {
      if (!response?.ok) setMessage(response?.error || "요청을 처리하지 못했습니다.");
      else setMessage("");
    });
  }

  function nextSlide(delta) {
    emit("goToSlide", { index: room.currentSlide + delta });
  }

  return (
    <main className="host-layout">
      <header className="topbar">
        <div>
          <p className="eyebrow">HOST CONTROL</p>
          <h1>SPEED QUIZ <span>{room.code}</span></h1>
        </div>
        <div className="topbar-actions">
          <CopyLinkButton room={room} role="viewer" label="뷰어 링크 복사" />
          <button className="danger-button" onClick={() => emit("endQuiz")}>퀴즈 종료</button>
        </div>
      </header>

      {message ? <p className="form-error wide">{message}</p> : null}

      <section className="host-grid">
        <div className="stage-panel blueprint-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">현재 슬라이드</p>
              <h2>{room.slides.length ? `${room.currentSlide + 1} / ${room.slides.length}` : "슬라이드 없음"}</h2>
            </div>
            <div className="step-controls">
              <button onClick={() => nextSlide(-1)} disabled={room.currentSlide <= 0}>이전</button>
              <button onClick={() => nextSlide(1)} disabled={room.currentSlide >= room.slides.length - 1}>다음</button>
            </div>
          </div>

          <SlideFrame slide={currentSlide} index={room.currentSlide} total={room.slides.length} />

          <div className={`buzzer-strip ${room.buzzerActive ? "buzzer-hot" : ""}`}>
            <button
              className={room.buzzerActive ? "armed-button" : "primary-button"}
              onClick={() => emit("setBuzzer", { active: !room.buzzerActive })}
            >
              {room.buzzerActive ? "버저 닫기" : "버저 활성화"}
            </button>
            <div className="buzzer-status">
              <strong>{room.buzzerActive ? "입력 받는 중" : "대기 중"}</strong>
              <span>{room.buzzes.length ? `${room.buzzes.length}명 입력됨` : "아직 입력 없음"}</span>
            </div>
          </div>

          <JudgePanel activeBuzz={room.activeBuzz} activePlayer={activePlayer} emit={emit} buzzerActive={room.buzzerActive} />
        </div>

        <aside className="side-stack">
          <UploadPanel room={room} setMessage={setMessage} />
          <PlayerSettings socket={socket} room={room} setMessage={setMessage} />
          <Scoreboard players={room.players} />
          <BuzzRanking room={room} />
        </aside>
      </section>

      {room.ended ? <CeremonyOverlay room={room} hostMode /> : null}
    </main>
  );
}

function UploadPanel({ room, setMessage }) {
  const [busy, setBusy] = useState(false);

  async function uploadSlides(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const formData = new FormData();
    files.forEach((file) => formData.append("slides", file));
    setBusy(true);
    setMessage("");

    try {
      const response = await fetch(`${SERVER_URL}/api/rooms/${room.code}/slides`, {
        method: "POST",
        body: formData
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "업로드에 실패했습니다.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <section className="tool-panel blueprint-panel">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">슬라이드</p>
          <h2>이미지 업로드</h2>
        </div>
        <span className="count-badge">{room.slides.length}장</span>
      </div>
      <label className="file-drop">
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={uploadSlides} disabled={busy} />
        <span>{busy ? "업로드 중..." : "PNG/JPG 여러 장 선택"}</span>
      </label>
      <p className="hint">PPT는 먼저 이미지로 내보낸 뒤 파일명을 01, 02처럼 맞춰 선택하면 순서 관리가 쉽습니다.</p>
    </section>
  );
}

function PlayerSettings({ socket, room, setMessage }) {
  const [draftPlayers, setDraftPlayers] = useState(room.players);

  useEffect(() => {
    setDraftPlayers(room.players);
  }, [room.players]);

  const duplicateKeys = findDuplicateKeys(draftPlayers);

  function setPlayerCount(count) {
    const next = Array.from({ length: count }, (_, index) => {
      return (
        draftPlayers[index] || {
          id: `p${index + 1}`,
          name: `플레이어 ${index + 1}`,
          key: DEFAULT_KEYS[index] || "",
          score: 0
        }
      );
    });
    setDraftPlayers(next);
  }

  function updatePlayer(index, field, value) {
    setDraftPlayers((players) =>
      players.map((player, playerIndex) =>
        playerIndex === index
          ? { ...player, [field]: field === "key" ? normalizeKeyLabel(value) : value }
          : player
      )
    );
  }

  function captureKey(index, event) {
    event.preventDefault();
    updatePlayer(index, "key", keyFromEvent(event));
  }

  function savePlayers() {
    socket.emit("updatePlayers", { roomCode: room.code, players: draftPlayers }, (response) => {
      if (!response?.ok) setMessage(response?.error || "플레이어 설정을 저장하지 못했습니다.");
      else setMessage("");
    });
  }

  return (
    <section className="tool-panel blueprint-panel">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">참가자</p>
          <h2>키 설정</h2>
        </div>
        <select value={draftPlayers.length} onChange={(event) => setPlayerCount(Number(event.target.value))}>
          {[2, 3, 4, 5, 6, 7, 8].map((count) => (
            <option key={count} value={count}>{count}명</option>
          ))}
        </select>
      </div>

      <div className="player-editor">
        {draftPlayers.map((player, index) => (
          <div className="player-row" key={player.id}>
            <input
              value={player.name}
              onChange={(event) => updatePlayer(index, "name", event.target.value)}
              aria-label={`${index + 1}번 플레이어 이름`}
            />
            <input
              className={duplicateKeys.has(player.key) ? "invalid-key" : ""}
              value={player.key}
              onChange={(event) => updatePlayer(index, "key", event.target.value)}
              onKeyDown={(event) => captureKey(index, event)}
              aria-label={`${player.name} 배정 키`}
            />
          </div>
        ))}
      </div>

      <button className="primary-button full-width" onClick={savePlayers}>설정 저장</button>
      {duplicateKeys.size ? <p className="form-error">중복된 키가 있습니다.</p> : null}
    </section>
  );
}

function Scoreboard({ players }) {
  return (
    <section className="tool-panel blueprint-panel">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">점수판</p>
          <h2>실시간 점수</h2>
        </div>
      </div>
      <div className="score-list">
        {players.map((player) => (
          <div className="score-row" key={player.id}>
            <span>{player.name}</span>
            <strong>{player.score}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function BuzzRanking({ room }) {
  return (
    <section className="tool-panel blueprint-panel">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">버저 순위</p>
          <h2>{room.activeBuzz ? `${room.activeBuzz.playerName} 답변 차례` : "대기"}</h2>
        </div>
      </div>
      <ol className="buzz-list">
        {room.buzzes.map((buzz, index) => (
          <li className={index === room.activeBuzzIndex ? "active-buzz" : ""} key={buzz.id}>
            <span>{buzz.rank}</span>
            <strong>{buzz.playerName}</strong>
            <em>{new Date(buzz.timestamp).toLocaleTimeString("ko-KR", { hour12: false })}</em>
          </li>
        ))}
      </ol>
      {!room.buzzes.length ? <p className="empty-note">버저가 눌리면 순서대로 표시됩니다.</p> : null}
    </section>
  );
}

function JudgePanel({ activeBuzz, activePlayer, emit, buzzerActive }) {
  return (
    <section className="judge-panel blueprint-panel">
      <div>
        <p className="eyebrow">우선 답변권</p>
        <h2>{activePlayer ? activePlayer.name : buzzerActive ? "입력 대기 중" : "버저를 활성화하세요"}</h2>
        <p>{activeBuzz ? `${activeBuzz.rank}등 · ${activeBuzz.key} 키` : "1등이 여기에 크게 표시됩니다."}</p>
      </div>
      <div className="judge-actions">
        <button className="correct-button" disabled={!activeBuzz} onClick={() => emit("judge", { correct: true })}>정답 +1</button>
        <button className="wrong-button" disabled={!activeBuzz} onClick={() => emit("judge", { correct: false })}>오답 -1</button>
      </div>
    </section>
  );
}

function ViewerScreen({ socket, room, message, setMessage }) {
  const pressedRef = useRef(new Set());
  const currentSlide = room.slides[room.currentSlide];
  const leader = room.buzzes[0];

  useEffect(() => {
    function onKeyDown(event) {
      const tagName = event.target?.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;
      if (event.repeat || !room.buzzerActive || room.ended) return;

      const key = keyFromEvent(event);
      if (pressedRef.current.has(key)) return;
      const player = room.players.find((entry) => entry.key === key);
      if (!player) return;

      pressedRef.current.add(key);
      socket.emit("buzz", { roomCode: room.code, key, clientTime: performance.now() }, (response) => {
        if (!response?.ok) setMessage(response?.error || "");
      });
    }

    function onKeyUp(event) {
      pressedRef.current.delete(keyFromEvent(event));
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [room, socket, setMessage]);

  useEffect(() => {
    if (!room.buzzerActive) pressedRef.current.clear();
  }, [room.buzzerActive]);

  return (
    <main className={`viewer-layout ${room.buzzerActive ? "viewer-buzzer-open" : ""} ${leader ? "viewer-has-leader" : ""}`}>
      <header className="viewer-topbar">
        <div>
          <p className="eyebrow">방 코드 {room.code}</p>
          <h1>{room.buzzerActive ? "버저 오픈" : "퀴즈 진행 중"}</h1>
        </div>
        <div className={`viewer-live ${room.buzzerActive ? "hot" : ""}`}>{room.buzzerActive ? "입력 가능" : "대기"}</div>
      </header>

      <section className="viewer-stage">
        <SlideFrame slide={currentSlide} large index={room.currentSlide} total={room.slides.length} />
        {room.buzzerActive && !leader ? (
          <div className="buzz-now-overlay">
            <span>BUZZ NOW</span>
            <strong>눌러!</strong>
            <div className="buzz-key-row">
              {room.players.map((player, index) => (
                <kbd style={{ animationDelay: `${index * 0.1}s` }} key={player.id}>{player.key}</kbd>
              ))}
            </div>
          </div>
        ) : null}
        {leader ? (
          <div className="leader-overlay">
            <span>1ST BUZZ</span>
            <div>
              <kbd>{leader.key}</kbd>
              <strong>{leader.playerName}</strong>
            </div>
            <em>0 ms · 답변권 획득</em>
          </div>
        ) : null}
      </section>

      <section className="viewer-bottom">
        <div className="viewer-keys">
          {room.players.map((player) => (
            <div className="key-chip" key={player.id}>
              <kbd>{player.key}</kbd>
              <span>{player.name}</span>
              <strong>{player.score}</strong>
            </div>
          ))}
        </div>
        <div className="viewer-rank">
          <p className="eyebrow">버저 결과</p>
          <h2>{leader ? `${leader.playerName} 1등` : room.buzzerActive ? "먼저 누르세요" : "호스트 대기 중"}</h2>
          <ol>
            {room.buzzes.slice(0, 6).map((buzz, index) => (
              <li className={index === room.activeBuzzIndex ? "active-buzz" : ""} key={buzz.id}>
                <span>{buzz.rank}</span>
                <strong>{buzz.playerName}</strong>
              </li>
            ))}
          </ol>
          {message ? <p className="form-error">{message}</p> : null}
        </div>
      </section>

      {room.ended ? <CeremonyOverlay room={room} /> : null}
    </main>
  );
}

function SlideFrame({ slide, large = false, index = -1, total = 0 }) {
  return (
    <div className={`slide-frame ${large ? "large-slide" : ""}`}>
      {total ? <span className="slide-counter">{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span> : null}
      {slide ? (
        <img src={slide.url} alt={slide.name || "퀴즈 슬라이드"} />
      ) : (
        <div className="empty-slide">
          <strong>슬라이드 준비 중</strong>
          <span>호스트가 이미지를 업로드하면 여기에 표시됩니다.</span>
        </div>
      )}
    </div>
  );
}

function CeremonyOverlay({ room, hostMode = false }) {
  const podium = room.ranking.slice(0, 3);
  return (
    <div className={`ceremony ${hostMode ? "host-ceremony" : ""}`}>
      <div className="ceremony-stage">
        <p className="eyebrow">퀴즈 종료</p>
        <h1>시상식</h1>
        <div className="podium">
          {podium.map((player, index) => (
            <div className={`podium-place place-${index + 1}`} key={player.id}>
              <span>{index + 1}위</span>
              <strong>{player.name}</strong>
              <em>{player.score}점</em>
            </div>
          ))}
        </div>
        <div className="final-ranking">
          {room.ranking.map((player, index) => (
            <div key={player.id}>
              <span>{index + 1}</span>
              <strong>{player.name}</strong>
              <em>{player.score}점</em>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CopyLinkButton({ room, role, label }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = new URL(window.location.href);
    url.searchParams.set("room", room.code);
    url.searchParams.set("role", role);
    await navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return <button onClick={copy}>{copied ? "복사됨" : label}</button>;
}

function keyFromEvent(event) {
  if (event.code === "Space") return "SPACE";
  if (event.key === "Enter") return "ENTER";
  return normalizeKeyLabel(event.key);
}

function normalizeKeyLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw === " ") return "SPACE";
  const upper = raw.toUpperCase();
  if (upper === "SPACE" || upper === "ENTER") return upper;
  return upper.slice(0, 1);
}

function findDuplicateKeys(players) {
  const counts = players.reduce((map, player) => {
    if (!player.key) return map;
    map.set(player.key, (map.get(player.key) || 0) + 1);
    return map;
  }, new Map());
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

createRoot(document.getElementById("root")).render(<App />);
