/** Everything lives inside the shadow root, so the host page cannot restyle the widget. */
export const STYLES = `
:host {
  all: initial;
  --brand: #1F5FBF;
  --on-brand: #fff;
  --ink: #16202A;
  --muted: #5A6672;
  --line: #D2D9E0;
  --soft: #F2F4F7;
  --bubble: #EEF2F6;
  --panel: #fff;
  --wa: #117A43;
  --warn: #9A4A12;
  --focus: #1F5FBF;
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483000;
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ink);
}
*, *::before, *::after { box-sizing: border-box; }
button, input, textarea { font: inherit; color: inherit; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
[hidden] { display: none !important; }

.launcher {
  width: 58px; height: 58px; border-radius: 50%; border: 0; cursor: pointer;
  background: var(--brand); color: var(--on-brand);
  box-shadow: 0 10px 28px -8px rgba(10,20,30,.45);
  display: grid; place-items: center;
}
.launcher svg { width: 28px; height: 28px; }

.panel {
  position: absolute; right: 0; bottom: 72px;
  width: 360px; height: 540px; max-height: calc(100vh - 110px);
  background: var(--panel); border: 1px solid var(--line); border-radius: 16px;
  box-shadow: 0 18px 44px -16px rgba(10,20,30,.45);
  display: flex; flex-direction: column; overflow: hidden;
}
@media (max-width: 479px) {
  :host { right: 12px; bottom: 12px; }
  .panel {
    position: fixed; inset: 0; width: 100vw; height: 100dvh; max-height: none;
    border-radius: 0; border: 0;
  }
}

.head {
  background: var(--brand); color: var(--on-brand);
  padding: 10px 12px; display: flex; align-items: center; gap: 10px; flex-shrink: 0;
}
.avatar {
  width: 34px; height: 34px; border-radius: 50%; flex: none;
  background: rgba(255,255,255,.22); display: grid; place-items: center; font-weight: 700;
}
.title { flex: 1; min-width: 0; }
.title b, .title small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.title small { font-size: 12px; opacity: .9; }
.head button {
  border: 1px solid currentColor; background: transparent; color: inherit;
  border-radius: 999px; padding: 4px 10px; font-size: 13px; font-weight: 600; cursor: pointer; flex: none;
}
.head .close { border: 0; font-size: 20px; line-height: 1; padding: 4px 8px; }

.messages {
  flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;
}
.messages > * { flex-shrink: 0; }
.msg { max-width: 85%; padding: 8px 12px; border-radius: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.msg.bot { background: var(--bubble); align-self: flex-start; border-bottom-left-radius: 4px; }
.msg.user { background: var(--brand); color: var(--on-brand); align-self: flex-end; border-bottom-right-radius: 4px; }
.notice { align-self: center; text-align: center; color: var(--muted); font-size: 13px; max-width: 90%; }
.typing { color: var(--muted); font-size: 13px; padding: 0 4px; }

.quick { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 8px; flex-shrink: 0; }
.quick button {
  border: 1px solid var(--brand); color: var(--brand); background: transparent;
  border-radius: 999px; padding: 4px 10px; font-size: 13px; cursor: pointer;
}

.composer { display: flex; gap: 6px; padding: 10px; border-top: 1px solid var(--line); flex-shrink: 0; }
.composer input {
  flex: 1; min-width: 0; border: 1px solid var(--line); background: var(--soft);
  border-radius: 999px; padding: 9px 14px;
}
.composer button {
  border: 0; background: var(--brand); color: var(--on-brand);
  border-radius: 999px; padding: 0 16px; font-weight: 600; cursor: pointer;
}
.composer button:disabled, .composer input:disabled { opacity: .6; cursor: not-allowed; }

.card { border: 1.5px solid var(--wa); border-radius: 14px; overflow: hidden; background: var(--panel); flex-shrink: 0; }
.card-head {
  background: var(--wa); color: #fff; padding: 7px 12px; font-weight: 600; font-size: 14px;
  display: flex; justify-content: space-between; gap: 8px;
}
.card-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
.card p { margin: 0; }
.card .warn { color: var(--warn); font-size: 13px; }
.card .hint { color: var(--muted); font-size: 13px; }
.preview { background: #E7F3EC; border-radius: 10px; padding: 10px; }
.preview p { margin: 0; background: #fff; border-radius: 10px 10px 10px 3px; padding: 8px 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.wa-button {
  display: block; text-align: center; text-decoration: none; font-weight: 600;
  background: var(--wa); color: #fff; border-radius: 10px; padding: 11px 12px;
}
.done { color: var(--wa); font-weight: 600; font-size: 13px; }
details summary { cursor: pointer; color: var(--muted); font-size: 13px; }
details form { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
details label { font-size: 13px; }
details input[type=text], details input[type=tel] {
  width: 100%; border: 1px solid var(--line); background: var(--soft); border-radius: 8px; padding: 7px 9px;
}
.consent { display: flex; gap: 6px; align-items: flex-start; font-size: 12px; color: var(--muted); }
details button {
  border: 1px solid var(--line); background: transparent; border-radius: 8px; padding: 8px; font-weight: 600; cursor: pointer;
}
.error { color: #B42318; font-size: 12px; }
.error:empty { display: none; }
`;
