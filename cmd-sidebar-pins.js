/*
 * Sidebar pins for the Command Code desktop app.
 * Injected by patch-sidebar.sh. Talks to the app only through the DOM hooks it
 * ships: nav[data-sidebar-chats], section[aria-label] per project, and
 * [data-thread-id] per row. Never imports app modules, never edits them.
 */
(() => {
  "use strict";

  const KEY = "cc-sidebar-pins-v1";
  const COLLAPSED = 4;
  const EXPANDED = 6;
  const MAX_PINNED = 3;
  const HOST_ID = "ccsp-host";
  /* Above the app's content, below its menus and dialogs (z-50 / z-[500]). */
  const HOST_Z = 2147482000;
  const NATIVE_MENU_Z = 40;

  /* Pulse for the running-session dot. CSP allows inline styles. */
  if (!document.getElementById("ccsp-style")) {
    const st = document.createElement("style");
    st.id = "ccsp-style";
    st.textContent = "@keyframes ccsp-pulse{0%,100%{opacity:1}50%{opacity:.35}}";
    (document.head || document.documentElement).append(st);
  }

  let state = { projects: {}, sessions: {}, expanded: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && typeof raw === "object") state = { ...state, ...raw };
  } catch {}
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  };

  const el = (tag, props = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "style") Object.assign(n.style, v);
      else if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v != null) n.setAttribute(k, v);
    }
    for (const c of [].concat(kids)) if (c != null) n.append(c);
    return n;
  };

  const nav = () => document.querySelector("nav[data-sidebar-chats]");

  /* The settings screen draws its own rail (nav.w-14 with a right border) and
     tags rows with [data-settings-label]. The workspace sidebar stays mounted
     behind it, so detect the settings screen itself — both markers are
     structural, not localized strings. */
  const settingsOpen = () =>
    !!document.querySelector('[data-settings-label], nav[class*="w-14"][class*="border-r"]');

  /* The app's chat list lives in its own ScrollArea viewport. That one element
     is the only anchor that lines up with the list; guessing by "tallest
     scroller" picks the shell's wrapper and the overlay then covers the whole
     sidebar. Fall back to the guess only if the class ever changes. */
  function viewport() {
    const n = nav();
    if (!n) return null;
    const owned = n.querySelector(".cc-scroll-viewport");
    if (owned) return owned;
    let best = null;
    for (const k of n.querySelectorAll("*")) {
      const s = getComputedStyle(k);
      if (!/(auto|scroll)/.test(s.overflowY)) continue;
      if (k === host || (host && host.contains(k))) continue;
      if (!best || k.clientHeight > best.clientHeight) best = k;
    }
    return best;
  }

  /* One record per project section:
     {id (path), name, rows, expanded, head, plus} */
  function projects() {
    const n = nav();
    if (!n) return [];
    const out = [];
    for (const sect of n.querySelectorAll("section[aria-label]")) {
      const head = sectionHead(sect);
      if (!head) continue;
      const id = head.path || sect.getAttribute("aria-label") || "";
      /* Collapsed projects render no rows at all, so the DOM has none to read;
         mirror the app's state instead of showing an empty block. */
      const rows = head.expanded
        ? [...sect.querySelectorAll("[data-thread-id]")].map((r) => ({
            id: r.getAttribute("data-thread-id"),
            title: (r.getAttribute("title") || r.textContent || "").trim(),
            active: r.getAttribute("aria-current") === "page",
            status: rowStatus(r.getAttribute("data-thread-id")),
          }))
        : [];
      /* The per-project new-chat button sits next to the header button. */
      const plus =
        [...(head.el.parentElement?.querySelectorAll("button") || [])].find((b) => b !== head.el) || null;
      out.push({ id, name: head.name, rows, expanded: head.expanded, head: head.el, plus });
    }
    return out;
  }

  /* A project header is the button whose title is the folder path. */
  function sectionHead(sect) {
    for (const b of sect.querySelectorAll("button[title]")) {
      const t = b.getAttribute("title") || "";
      if (t.startsWith("/"))
        return {
          path: t,
          name: (b.textContent || "").trim(),
          expanded: b.getAttribute("aria-expanded") !== "false",
          el: b,
        };
    }
    return null;
  }

  function clickRow(threadId) {
    const n = nav();
    const row = n && n.querySelector(`[data-thread-id="${CSS.escape(threadId)}"]`);
    if (row) row.click();
  }

  /* The app marks a working session with its cc-spinner icon and a pending
     permission/question with a warning icon; those classes are the only DOM
     trace of the state, and they sit under our opaque host. */
  function rowStatus(threadId) {
    const row = nav()?.querySelector(`[data-thread-id="${CSS.escape(threadId)}"]`);
    if (!row) return "";
    if (row.querySelector("svg.cc-spinner")) return "running";
    if (row.querySelector("svg.text-warning")) return "attention";
    return "";
  }

  function toast(text) {
    let t = document.getElementById("ccsp-toast");
    if (!t) {
      t = el("div", {
        id: "ccsp-toast",
        style: {
          position: "fixed",
          bottom: "18px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 2147483000,
          padding: "8px 14px",
          borderRadius: "9px",
          background: "#222",
          color: "#fff",
          font: "12px system-ui, sans-serif",
          boxShadow: "0 8px 24px rgba(0,0,0,.35)",
          pointerEvents: "none",
        },
      });
      document.body.append(t);
    }
    t.textContent = text;
    t.style.display = "block";
    clearTimeout(t._timer);
    t._timer = setTimeout(() => (t.style.display = "none"), 2600);
  }

  function pinSession(projectId, threadId, title) {
    const list = state.sessions[projectId] || (state.sessions[projectId] = []);
    if (list.some((p) => p.id === threadId)) {
      state.sessions[projectId] = list.filter((p) => p.id !== threadId);
      save();
      render();
      return;
    }
    if (list.length >= MAX_PINNED) {
      const evicted = list[list.length - 1];
      state.sessions[projectId] = [{ id: threadId, title, pinnedAt: Date.now() }, ...list.slice(0, MAX_PINNED - 1)];
      save();
      render();
      toast(`Replaced "${evicted.title}" with "${title}" — max ${MAX_PINNED} pinned.`);
      return;
    }
    state.sessions[projectId] = [{ id: threadId, title, pinnedAt: Date.now() }, ...list];
    save();
    render();
  }

  function pinProject(projectId, name) {
    if (state.projects[projectId]) delete state.projects[projectId];
    else state.projects[projectId] = { name, pinnedAt: Date.now() };
    save();
    render();
  }

  function menu(x, y, items) {
    document.getElementById("ccsp-menu")?.remove();
    let detach = () => {};
    const m = el(
      "div",
      {
        id: "ccsp-menu",
        style: {
          position: "fixed",
          left: `${x}px`,
          top: `${y}px`,
          zIndex: 2147483000,
          minWidth: "180px",
          padding: "4px",
          border: "1px solid #444",
          borderRadius: "8px",
          background: "#1e1e22",
          color: "#eee",
          font: "12px system-ui, sans-serif",
          boxShadow: "0 10px 28px rgba(0,0,0,.45)",
        },
      },
      items.map((it) =>
        el(
          "button",
          {
            style: {
              display: "block",
              width: "100%",
              padding: "7px 10px",
              textAlign: "left",
              background: "transparent",
              color: "inherit",
              border: "0",
              borderRadius: "6px",
              cursor: "pointer",
            },
            onclick: () => {
              detach();
              m.remove();
              it.run();
            },
          },
          it.label,
        ),
      ),
    );
    document.body.append(m);
    /* Dismiss only on a press outside the menu. `once` here also ate the item's
       own click: pointerdown lands first, removing the button before mouseup. */
    const close = (e) => {
      if (m.contains(e.target)) return;
      detach();
      m.remove();
    };
    detach = () => document.removeEventListener("pointerdown", close, true);
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  }

  /* The overlay covers the app's own rows, so their context menus are otherwise
     unreachable. Re-dispatch the event on the real trigger — the app's Radix
     menu reads the coordinates off it — and drop the host under the menu portal
     while it is open so the opaque list does not hide it. The first click after
     that restores the host; if it lands on the host it is swallowed, or it would
     also open a chat. */
  function nativeMenu(find, e) {
    const target = find();
    if (!target) return;
    host.style.zIndex = String(NATIVE_MENU_Z);
    const restore = (ev) => {
      host.style.zIndex = String(HOST_Z);
      document.removeEventListener("click", restore, true);
      document.removeEventListener("keydown", restore, true);
      if (ev && host.contains(ev.target)) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    };
    document.addEventListener("click", restore, true);
    document.addEventListener("keydown", restore, true);
    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: e.clientX,
        clientY: e.clientY,
      }),
    );
  }

  const projectTrigger = (p) =>
    [...document.querySelectorAll("nav[data-sidebar-chats] section[aria-label]")]
      .find((s) => (sectionHead(s) || {}).path === p.id)
      ?.querySelector("button[title]") || null;

  const rowTrigger = (threadId) =>
    nav()?.querySelector(`[data-thread-id="${CSS.escape(threadId)}"]`) || null;

  /* ---------------------------------------------------------------- render */

  let host = null;

  function hide() {
    host?.remove();
    host = null;
  }

  function render() {
    const vp = viewport();
    const n = nav();
    /* Fail safe: without a real list viewport we draw nothing at all, rather
       than covering the sidebar header and its buttons. Also remove whatever
       was drawn before — on other screens (e.g. settings) the workspace DOM
       hides or unmounts, and a stale host would keep covering the page. */
    if (!n || !vp || settingsOpen()) return hide();
    const rect = vp.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return hide();
    if (!host || !host.isConnected) {
      host = el("div", {
        id: HOST_ID,
        style: {
          position: "fixed",
          zIndex: 2147482000,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          /* Opaque on purpose: a transparent host lets the app's own rows show
             through it, and both lists read as one garbled column. The token
             follows the app's light/dark theme. */
          background: "hsl(var(--sidebar, 240 34.5% 11.4%))",
          font: "13px system-ui, sans-serif",
          color: "#ddd",
        },
      });
      document.body.append(host);
      host.addEventListener("pointerdown", (e) => e.stopPropagation());
    }
    Object.assign(host.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });

    const list = projects();
    if (!list.length) {
      hide();
      return;
    }
    const pinnedProjects = Object.entries(state.projects)
      .sort((a, b) => b[1].pinnedAt - a[1].pinnedAt)
      .filter(([id]) => list.some((p) => p.id === id));

    host.replaceChildren();
    if (pinnedProjects.length) {
      host.append(sectionLabel(`Pinned · ${pinnedProjects.length}`));
      for (const [id, meta] of pinnedProjects) {
        const p = list.find((x) => x.id === id);
        host.append(projectBlock(p || { id, name: meta.name, rows: [] }, true));
      }
      host.append(sectionLabel("Projects"));
    }

    for (const p of list.filter((x) => !state.projects[x.id])) host.append(projectBlock(p, false));
  }

  const sectionLabel = (text) =>
    el(
      "div",
      {
        style: {
          padding: "10px 10px 4px",
          fontSize: "10px",
          letterSpacing: ".08em",
          textTransform: "uppercase",
          opacity: ".55",
        },
      },
      text,
    );

  function projectBlock(p, inPinnedSection) {
    const collapsed = p.expanded === false;
    const pinned = (state.sessions[p.id] || []).filter((x) => p.rows.some((r) => r.id === x.id));
    const pinnedIds = new Set(pinned.map((x) => x.id));
    const unpinned = p.rows.filter((r) => !pinnedIds.has(r.id));
    const expanded = !!state.expanded[p.id];
    /* Collapsed: first few rows. Expanded: all of them inside a fixed-height
       window, otherwise the row cap equals the window height and nothing ever
       scrolls. */
    const visible = expanded ? unpinned : unpinned.slice(0, COLLAPSED);

    const head = el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 8px",
          fontWeight: "600",
          cursor: "pointer",
        },
        /* A collapsed project has no rows to draw, so hand the click back and
           let the app expand (and select) it, as its own header does. */
        onclick: () => {
          if (collapsed) p.head?.click();
        },
        oncontextmenu: (e) => {
          e.preventDefault();
          menu(e.clientX, e.clientY, [
            {
              label: state.projects[p.id] ? "Unpin project" : "Pin project to top",
              run: () => pinProject(p.id, p.name),
            },
            { label: "More actions…", run: () => nativeMenu(() => projectTrigger(p), e) },
          ]);
        },
      },
      [
        el("span", { style: { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, p.name || p.id),
        collapsed ? el("span", { style: { opacity: ".55", fontSize: "10px" } }, "▸") : null,
        /* The app's own new-chat button is under our host, so mirror it. */
        p.plus
          ? el(
              "button",
              {
                title: "New chat",
                style: { background: "transparent", border: "0", cursor: "pointer", color: "inherit", opacity: ".6" },
                onclick: (e) => {
                  e.stopPropagation();
                  p.plus.click();
                },
              },
              "+",
            )
          : null,
        el(
          "button",
          {
            title: state.projects[p.id] ? "Unpin project" : "Pin project",
            style: { background: "transparent", border: "0", cursor: "pointer", color: "inherit", opacity: state.projects[p.id] ? "1" : ".45" },
            onclick: (e) => {
              e.stopPropagation();
              pinProject(p.id, p.name);
            },
          },
          state.projects[p.id] ? "📌" : "📍",
        ),
        unpinned.length > COLLAPSED && !collapsed
          ? el(
              "button",
              {
                title: expanded ? "Show less" : "Show all",
                style: { background: "transparent", border: "0", cursor: "pointer", color: "inherit", opacity: ".6" },
                onclick: (e) => {
                  e.stopPropagation();
                  state.expanded[p.id] = !expanded;
                  save();
                  render();
                },
              },
              expanded ? "−" : `+${unpinned.length - COLLAPSED}`,
            )
          : null,
      ],
    );

    const rows = [];
    if (collapsed) return el("div", { style: { marginBottom: inPinnedSection ? "10px" : "2px" } }, [head]);
    if (pinned.length) {
      rows.push(el("div", { style: { padding: "2px 10px", fontSize: "10px", opacity: ".5" } }, `Pinned · ${pinned.length}/${MAX_PINNED}`));
      for (const pin of pinned) rows.push(rowEl(p, { id: pin.id, title: pin.title, active: false, status: rowStatus(pin.id) }, true));
    }
    if (expanded) {
      rows.push(
        el(
          "div",
          { style: { maxHeight: `${EXPANDED * 30}px`, overflowY: "auto" } },
          visible.map((r) => rowEl(p, r, false)),
        ),
      );
    } else {
      for (const r of visible) rows.push(rowEl(p, r, false));
    }

    return el("div", { style: { marginBottom: inPinnedSection ? "10px" : "2px" } }, [head, ...rows]);
  }

  function rowEl(p, row, isPinned) {
    return el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          height: "30px",
          /* Indent under the project header, matching the app's list. */
          padding: "0 8px 0 16px",
          borderRadius: "6px",
          cursor: "pointer",
          background: row.active ? "rgba(120,160,255,.18)" : "transparent",
          overflow: "hidden",
        },
        onmouseenter: (e) => (e.currentTarget.style.background = "rgba(255,255,255,.06)"),
        onmouseleave: (e) => (e.currentTarget.style.background = row.active ? "rgba(120,160,255,.18)" : "transparent"),
        onclick: () => clickRow(row.id),
        oncontextmenu: (e) => {
          e.preventDefault();
          menu(e.clientX, e.clientY, [
            {
              label: isPinned ? "Unpin session" : `Pin session (max ${MAX_PINNED})`,
              run: () => pinSession(p.id, row.id, row.title),
            },
            { label: "More actions…", run: () => nativeMenu(() => rowTrigger(row.id), e) },
          ]);
        },
      },
      [
        row.status
          ? el("span", {
              title: row.status === "running" ? "Running" : "Needs your attention",
              style: {
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                flexShrink: "0",
                background: row.status === "running" ? "#7aa2f7" : "#f0b429",
                animation: row.status === "running" ? "ccsp-pulse 1.2s ease-in-out infinite" : "",
              },
            })
          : null,
        el("span", { style: { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, row.title || "New chat"),
      ],
    );
  }

  /* --------------------------------------------------------------- palette */

  let palette = null;
  let flat = [];
  let focus = 0;

  function openPalette() {
    const list = projects();
    const pinnedProjects = Object.entries(state.projects)
      .sort((a, b) => b[1].pinnedAt - a[1].pinnedAt)
      .filter(([id]) => list.some((p) => p.id === id));
    flat = [];
    const seen = new Set();
    for (const [id] of pinnedProjects) {
      const p = list.find((x) => x.id === id);
      if (!p) continue;
      flat.push({ label: p.name, run: () => clickRow((p.rows[0] || {}).id) });
      for (const pin of state.sessions[id] || []) {
        if (p.rows.some((r) => r.id === pin.id) && !seen.has(pin.id)) {
          seen.add(pin.id);
          flat.push({ label: `· ${pin.title}`, run: () => clickRow(pin.id) });
        }
      }
    }
    /* Pins in projects that are not themselves pinned still belong here. */
    for (const p of list) {
      if (state.projects[p.id]) continue;
      for (const pin of state.sessions[p.id] || []) {
        if (p.rows.some((r) => r.id === pin.id) && !seen.has(pin.id)) {
          seen.add(pin.id);
          flat.push({ label: `${p.name} · ${pin.title}`, run: () => clickRow(pin.id) });
        }
      }
    }
    if (!flat.length) {
      toast("No pinned projects or sessions yet — right-click a project or session to pin it.");
      return;
    }
    closePalette();
    palette = el("div", {
      style: {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: 2147483600,
        width: "300px",
        maxHeight: "60vh",
        overflowY: "auto",
        padding: "8px",
        borderRadius: "12px",
        border: "1px solid #444",
        background: "#1c1c20",
        color: "#eee",
        font: "12px system-ui, sans-serif",
        boxShadow: "0 16px 44px rgba(0,0,0,.5)",
      },
    });
    palette.append(el("div", { style: { padding: "4px 6px 8px", textTransform: "uppercase", letterSpacing: ".08em", opacity: ".55", fontSize: "10px" } }, "Pinned"));
    flat.forEach((item, i) => {
      palette.append(
        el(
          "div",
          {
            id: `ccsp-item-${i}`,
            style: { padding: "7px 8px", borderRadius: "7px", cursor: "pointer", opacity: i === focus ? "1" : ".85", background: i === focus ? "rgba(120,160,255,.22)" : "transparent" },
            onmouseenter: () => {
              focus = i;
              paint();
            },
            onclick: () => {
              closePalette();
              item.run();
            },
          },
          item.label,
        ),
      );
    });
    document.body.append(palette);
    paint();
  }

  function paint() {
    if (!palette) return;
    flat.forEach((_, i) => {
      const n = palette.querySelector(`#ccsp-item-${i}`);
      if (n) n.style.background = i === focus ? "rgba(120,160,255,.22)" : "transparent";
    });
    palette.querySelector(`#ccsp-item-${focus}`)?.scrollIntoView({ block: "nearest" });
  }

  function closePalette() {
    palette?.remove();
    palette = null;
  }

  /* ---------------------------------------------------------------- wiring */

  document.addEventListener(
    "keydown",
    (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "ArrowUp") {
        const t = e.target;
        if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
        e.preventDefault();
        e.stopPropagation();
        openPalette();
        return;
      }
      if (!palette) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closePalette();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        focus = Math.min(flat.length - 1, focus + 1);
        paint();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focus = Math.max(0, focus - 1);
        paint();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = flat[focus];
        closePalette();
        item?.run();
      }
    },
    true,
  );

  let queued = null;
  const schedule = () => {
    if (queued) return;
    queued = setTimeout(() => {
      queued = null;
      render();
    }, 150);
  };

  /* Ignore our own writes, or rendering would re-trigger the observer forever. */
  const ours = (node) => !!(host && (node === host || host.contains(node)));

  /* Opening settings mounts the settings screen, which is a DOM change, so the
     observer below runs render() and render() hides. Ask for the settings
     screen's own markup rather than the gear's label, which is localized. */

  new MutationObserver((records) => {
    for (const r of records) {
      if (ours(r.target)) continue;
      return schedule();
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label", "data-thread-id"],
  });
  window.addEventListener("resize", schedule);
  schedule();
})();
