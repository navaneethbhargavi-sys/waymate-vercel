/* ============================================================
   Waymate — client app logic
   Account, route, buddy, message, and trip data is server-backed.
   ============================================================ */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
async function api(path, options = {}) {
  const token = new URLSearchParams(location.search).get("clerk_token");
  const headers = Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}, options.headers || {});
  const response = await fetch(path, Object.assign({}, options, { headers, credentials: "include" }));
  if (!response.ok) {
    let message = "Request failed";
    try {
      const payload = await response.json();
      const error = payload.error;
      if (typeof error === "string") message = error;
      else if (error && error.fieldErrors) {
        const fields = Object.entries(error.fieldErrors)
          .flatMap(([field, errors]) => Array.isArray(errors) ? errors.map(text => field + ": " + text) : [])
          .join(" · ");
        message = fields || message;
      }
    } catch (e) {}
    throw new Error(typeof message === "string" ? message : "Request failed");
  }
  return response.status === 204 ? null : response.json();
}

const memoryStore = Object.create(null);
const store = {
  get(key, fallback) {
    return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : fallback;
  },
  set(key, value) {
    memoryStore[key] = value;
  },
  del(key) {
    delete memoryStore[key];
  }
};

function profileFromApi(profile) {
  if (!profile) return null;
  return {
    id: profile.clerkUserId,
    name: profile.name,
    gender: profile.gender,
    age: profile.age,
    bio: profile.bio || "",
    photo: profile.photo || null,
    verified: true,
    contact: "",
    joined: profile.createdAt
  };
}

function postFromApi(post) {
  return Object.assign({}, post, {
    from: post.from || post.fromStation,
    to: post.to || post.toStation,
    t: post.t || new Date(post.departureAt).getTime(),
    pref: post.pref || post.preference,
    owner: post.user ? profileFromApi(post.user) : null
  });
}


const state = {
  user: null,
  screen: "home",
  booking: null,     // {from,to,depMode,depTime,pax,type}
  post: null,        // buddy post being created/edited
  payTrip: null,
  chatWith: null,
  chatReturn: "buddy",
  lastTicketId: null,
  pickFor: null,
  reg: null,
  passedMatches: [],
  socialTab: "buddies",
  posts: [],
  connections: [],
  trips: [],
  messages: [],
  loading: true,
  searchResults: [],
  searchReturn: "buddies",
  searchDebounce: null
};
let realtimeSource = null;

function startRealtimeMessages() {
  if (realtimeSource) realtimeSource.close();
  realtimeSource = new EventSource("/api/messages/stream", { withCredentials: true });
  realtimeSource.addEventListener("message", event => {
    try {
      const payload = JSON.parse(event.data || "{}");
      const message = payload.message;
      if (!message || !state.user || message.recipientId !== state.user.id) return;
      const alreadyPresent = state.messages.some(item => item.id === message.id);
      if (alreadyPresent) return;
      if (state.chatWith && state.chatWith.id === message.senderId) {
        state.messages.push(message);
        renderChat();
      } else {
        toast("New message from a buddy");
      }
    } catch (error) {
      console.warn("Could not process realtime message", error);
    }
  });
  realtimeSource.onerror = () => {
    // EventSource automatically reconnects; keep the UI usable while offline.
  };
}

/* ---------- small helpers ---------- */
const stn = name => BLUE_LINE.find(s => s.name === name);
const esc = s => String(s == null ? "" : s);

function fmtTime(ms) {
  const d = new Date(ms);
  let h = d.getHours(); const m = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return h + ":" + String(m).padStart(2, "0") + " " + ap;
}
const minsUntil = ms => Math.max(0, Math.round((ms - Date.now()) / 60000));

const routeFor = br => BLUE_LINE.filter(s => s.br === "T" || s.br === br);
const YB = "Yamuna Bank";

/* Station path between two Blue Line stations (handles both branches,
   including Vaishali ↔ Noida trips that connect at Yamuna Bank). */
function pathBetween(aName, bName) {
  const a = stn(aName), b = stn(bName);
  if (!a || !b || aName === bName) return [];
  if (a.br === b.br || a.br === "T" || b.br === "T") {
    const br = a.br !== "T" ? a.br : (b.br !== "T" ? b.br : "V");
    const route = routeFor(br);
    const ia = route.indexOf(a), ib = route.indexOf(b);
    const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
    const seg = route.slice(lo, hi + 1);
    return route[ia] === seg[0] ? seg : seg.slice().reverse();
  }
  const rA = routeFor(a.br), rB = routeFor(b.br);
  const yb = stn(YB);
  const ia = rA.indexOf(a), iy1 = rA.indexOf(yb);
  const ib = rB.indexOf(b), iy2 = rB.indexOf(yb);
  const segA = ia < iy1 ? rA.slice(ia, iy1 + 1) : rA.slice(iy1, ia + 1).reverse();
  const segB = ib > iy2 ? rB.slice(iy2, ib + 1) : rB.slice(ib, iy2 + 1).reverse();
  return segA.concat(segB.slice(1));
}

function pathKm(path) {
  let k = 0;
  for (let i = 1; i < path.length; i++) k += Math.abs(path[i].km - path[i - 1].km);
  return k;
}
function journeyMins(path) { return Math.max(4, Math.round((path.length - 1) * 2.2)); }

function initials(name) { return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase(); }
const AV_COLORS = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#6366f1", "#ec4899", "#14b8a6"];
function avColor(name) { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997; return AV_COLORS[h % AV_COLORS.length]; }
function avatarHTML(user, size) {
  const s = size || 44;
  if (user && user.photo) return '<img class="avatar" style="width:' + s + 'px;height:' + s + 'px" src="' + user.photo + '" alt="" />';
  const n = user ? user.name : "?";
  return '<div class="avatar" style="width:' + s + 'px;height:' + s + 'px;background:' + avColor(n) + ';font-size:' + Math.round(s * 0.36) + 'px">' + initials(n) + '</div>';
}

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2400);
}

/* ---------- router ---------- */
function go(name) {
  state.screen = name;
  $$(".screen").forEach(s => s.classList.add("hidden"));
  const el = $("#screen-" + name);
  if (el) el.classList.remove("hidden");
  const tab = ({ home: "home", buddy: "buddy", buddies: "buddies", profile: "profile" })[name] || null;
  $$("#tabbar button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  updateTabBadges();
  $("#tabbar").classList.toggle("hidden", !tab);
  $("#appbar").classList.toggle("hidden", name === "auth" || name === "search");
  $("#appbarRight").innerHTML = state.user && name !== "auth"
    ? '<div class="appbar-actions"><button class="avatar-btn" onclick="go(\'profile\')" aria-label="Open profile">' + avatarHTML(state.user, 34) + "</button></div>"
    : "";
  const r = {
    home: renderHome, tickets: renderTickets, buddy: renderBuddy, buddies: renderBuddies, search: renderPeopleSearch, profile: renderProfile,
    ticket: renderTicket, post: renderPost, chat: renderChat, auth: renderAuth
  }[name];
  if (r) r();
  $("#content").classList.toggle("chat-mode", name === "chat");
  $("#content").scrollTop = 0;
}

function unreadCount() {
  return 0;
}
function updateTabBadges() {
  const b = $('#tabbar button[data-tab="buddies"]');
  if (!b) return;
  const s = socialState();
  const count = s.incoming.length + unreadCount();
  b.innerHTML = '<span>🫂</span>Buddies' + (count ? ' <em class="tab-badge">' + count + '</em>' : '');
}
function markChatRead(id) { updateTabBadges(); }
function reportUser(id) { toast("Report noted — safety review is not yet connected"); }
function blockUser(id) {
  toast("Blocking will be available after the moderation service is connected");
}
/* ================= AUTH ================= */
function renderAuth() {
  if (!state.reg) state.reg = { step: state.user ? 0 : 2, contact: "", name: "", gender: "", age: "", photo: null };
  const el = $("#screen-auth");

  if (state.reg.step === 0) {
    el.innerHTML =
      '<div class="auth">' +
        '<div class="auth-hero">🚇</div>' +
        "<h1>Waymate</h1>" +
        '<p class="muted center">Meet someone who is headed your way. Real routes, real timing, better chemistry.</p>' +
        '<button class="btn primary block" onclick="continueAs()">Continue as ' + esc(state.user.name) + "</button>" +
        '<button class="btn ghost block" onclick="state.reg={step:1};renderAuth()">Use a different account</button>' +
        '<p class="fineprint center">Your session is protected by Waymate account security.</p>' +
      "</div>";
    return;
  }

  /* profile setup — profile (as per the plan notes: name, gender, age, photo) */
  const g = state.reg.gender;
  el.innerHTML =
    '<div class="auth">' +
      '<div class="auth-hero small">👤</div>' +
      "<h2>Your profile</h2>" +
      '<p class="muted center">This is what travel buddies will see.</p>' +
      '<div class="center" style="margin-bottom:14px">' +
        '<img id="photoPreview" class="avatar" style="width:84px;height:84px;font-size:26px;' + (state.reg.photo ? "" : "display:none") + '" src="' + (state.reg.photo || "") + '" />' +
        (!state.reg.photo ? '<div class="avatar" id="photoStub" style="width:84px;height:84px;background:#c3d6ee;font-size:26px;margin:0 auto">📷</div>' : "") +
        '<div><label class="btn ghost small-btn" style="display:inline-block;margin-top:8px">Choose photo' +
          '<input type="file" accept="image/*" style="display:none" onchange="handlePhoto(this)" /></label></div>' +
      "</div>" +
      '<label class="field"><span>Full name</span>' +
        '<input class="input" placeholder="e.g. Aman Gupta" value="' + esc(state.reg.name) + '" oninput="state.reg.name=this.value" /></label>' +
      '<span class="field-label">Gender</span>' +
      '<div class="chips">' +
        [["M", "Male"], ["F", "Female"], ["O", "Other"]].map(x =>
          '<button class="chip ' + (g === x[0] ? "on" : "") + '" onclick="state.reg.gender=\'' + x[0] + '\';renderAuth()">' + x[1] + "</button>").join("") +
      "</div>" +
      '<label class="field"><span>Age</span>' +
        '<input class="input" type="number" min="10" max="120" placeholder="e.g. 21" value="' + esc(state.reg.age) + '" oninput="state.reg.age=this.value" /></label>' +
      '<button class="btn primary block" onclick="regComplete()">Save profile →</button>' +
      (!state.user ? '<button class="btn ghost block" onclick="skipProfileSetup()">Skip for now →</button>' : '') +
      (state.user ? '<button class="btn ghost block" onclick="state.reg={step:0};renderAuth()">Back</button>' : "") +
    "</div>";
}

function regSendOtp() {
  const c = (state.reg.contact || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) { toast("Enter a valid email address"); return; }
  state.reg.step = 3;
  renderAuth();
}

async function regComplete() {
  const r = state.reg;
  if ((r.name || "").trim().length < 3) { toast("Enter your full name"); return; }
  if (!r.gender) { toast("Select your gender"); return; }
  const age = Number(r.age);
  if (!age || age < 10 || age > 120) { toast("Enter an age between 10 and 120"); return; }
  try {
    const result = await api("/api/profile", {
      method: "PUT",
      body: JSON.stringify({ name: r.name.trim(), gender: r.gender, age, bio: "", photo: r.photo || null })
    });
    state.user = profileFromApi(result.user);
    state.reg = null;
    await loadServerState();
    toast("Welcome, " + state.user.name.split(" ")[0] + "!");
    go("buddy");
  } catch (e) {
    toast(e.message || "Could not save your profile");
  }
}

function continueAs() { go("buddy"); }

async function skipProfileSetup() {
  // Keep onboarding optional: authenticated users can explore immediately and
  // complete their profile later from the Profile tab.
  state.user = {
    id: "pending-profile",
    name: "Traveler",
    gender: "",
    age: "",
    bio: "",
    photo: null,
    verified: true,
    contact: ""
  };
  state.reg = null;
  try {
    await loadServerState();
    startRealtimeMessages();
  } catch (e) {
    state.posts = [];
    state.trips = [];
    state.connections = [];
    toast("You’re in offline mode — profile setup is still available.");
  }
  go("buddy");
}

function handlePhoto(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = 256; c.height = 256;
      const ctx = c.getContext("2d");
      const min = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, 256, 256);
      state.reg.photo = c.toDataURL("image/jpeg", 0.85);
      renderAuth();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(f);
}

/* ================= HOME (booking) ================= */
function defaultBooking() {
  const last = store.get("lastTrip", null) || {};
  return {
    from: last.from || "",
    to: last.to || "",
    depMode: "now", depTime: "",
    pax: last.pax || 1,
    type: last.type || "single"
  };
}

function nextTrains() {
  const m = new Date().getMinutes();
  const off = (5 - (m % 5)) % 5 || 5;
  return [off, off + 5, off + 10].map(o => ({ at: Date.now() + o * 60000, in: o }));
}

function bookingTrip() {
  const b = state.booking;
  if (!b.from || !b.to || b.from === b.to) return null;
  const path = pathBetween(b.from, b.to);
  if (path.length < 2) return null;
  const km = pathKm(path), fare = fareForKm(km);
  let t;
  if (b.depMode === "now") t = Date.now() + 3 * 60000;
  else if (b.depMode === "15") t = Date.now() + 15 * 60000;
  else if (b.depMode === "30") t = Date.now() + 30 * 60000;
  else {
    const parts = (b.depTime || "").split(":").map(Number);
    if (isNaN(parts[0])) t = Date.now() + 3 * 60000;
    else {
      const d = new Date(); d.setHours(parts[0], parts[1] || 0, 0, 0);
      if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
      t = d.getTime();
    }
  }
  return {
    from: b.from, to: b.to, path, km, fare, pax: b.pax, type: b.type, t,
    total: fare * b.pax * (b.type === "return" ? 2 : 1)
  };
}

function renderHome() {
  if (!state.user) { go("auth"); return; }
  const el = $("#screen-home");
  if (!state.booking) state.booking = defaultBooking();
  const b = state.booking;
  const trains = nextTrains();
  const active = state.trips.find(t => t.status === "planned");

  el.innerHTML =
    '<div class="hello">Hi ' + esc(state.user.name.split(" ")[0]) + ' 👋 <span class="muted">where to?</span></div>' +

    '<div class="card train-card">' +
      '<div class="row spread"><strong>Next Blue Line trains</strong><span class="badge ok">On time</span></div>' +
      '<div class="train-times">' + trains.map(t =>
        '<div class="train-chip"><b>' + t.in + ' min</b><span>' + fmtTime(t.at) + "</span></div>").join("") + "</div>" +
    "</div>" +

    (active ?
      '<button class="active-mini" onclick="state.lastTicketId=\'' + active.id + '\';go(\'ticket\')">' +
        "<span style=\u0022font-size:22px\u0022>🗺️</span><span><b>Saved trip: " + esc(active.fromStation || active.from) + " → " + esc(active.toStation || active.to) + "</b>" +
        "<span class='muted'>Departs " + fmtTime(new Date(active.departureAt || active.t).getTime()) + " • tap to view</span></span></button>" : "") +

    '<div class="card book-card">' +
      '<div class="station-row">' +
        '<div class="st-box" onclick="openPicker(\'from\')"><span class="st-label">From</span>' +
          '<span class="st-name' + (b.from ? "" : " placeholder") + '">' + (b.from ? esc(b.from) : "Select station") + "</span></div>" +
        '<button class="swap" onclick="swapStations()" title="Swap">⇅</button>' +
        '<div class="st-box" onclick="openPicker(\'to\')"><span class="st-label">To</span>' +
          '<span class="st-name' + (b.to ? "" : " placeholder") + '">' + (b.to ? esc(b.to) : "Select station") + "</span></div>" +
      "</div>" +

      '<span class="field-label">Departure</span>' +
      '<div class="chips">' +
        [["now", "Now"], ["15", "+15 min"], ["30", "+30 min"], ["custom", "⏰ Pick time"]].map(x =>
          '<button class="chip ' + (b.depMode === x[0] ? "on" : "") + '" onclick="setDepMode(\'' + x[0] + '\')">' + x[1] + "</button>").join("") +
      "</div>" +
      (b.depMode === "custom" ? '<input type="time" class="input" style="margin-bottom:12px" value="' + esc(b.depTime) + '" onchange="state.booking.depTime=this.value;refreshFare()" />' : "") +

      '<span class="field-label">Passengers</span>' +
      '<div class="row" style="margin-bottom:12px">' +
        '<button class="icon-btn" onclick="changePax(-1)">−</button>' +
        '<b style="width:34px;text-align:center;font-size:17px">' + b.pax + "</b>" +
        '<button class="icon-btn" onclick="changePax(1)">+</button>' +
      "</div>" +

      '<span class="field-label">Journey type</span>' +
      '<div class="chips">' +
        [["single", "Single"], ["return", "Return (₹ × 2)"]].map(x =>
          '<button class="chip ' + (b.type === x[0] ? "on" : "") + '" onclick="state.booking.type=\'' + x[0] + '\';renderHome()">' + x[1] + "</button>").join("") +
      "</div>" +

      '<div class="fare-box" id="fareBox"></div>' +
      '<button class="btn primary block" id="payBtn" style="margin-bottom:0" onclick="startPayment()">Save trip plan</button>' +
      '<div class="fare-note center">Save your route and departure details to your Waymate account.</div>' +
    "</div>" +

    '<button class="card buddy-promo" onclick="go(\'buddy\')">' +
      '<span class="big">💞</span><span><strong>Metro timepass, sorted.</strong>' +
      "<span>Match with commuters on your train &amp; chat</span></span></button>";
  refreshFare();
}

function refreshFare() {
  const box = $("#fareBox"), btn = $("#payBtn");
  if (!box || !btn) return;
  const trip = bookingTrip();
  if (!trip) {
    box.innerHTML = '<span class="muted small">Select <b>From</b> and <b>To</b> stations to see fare & time</span>';
    btn.classList.add("disabled");
    btn.textContent = "Save trip plan";
    return;
  }
  btn.classList.remove("disabled");
  box.innerHTML =
    '<div class="fare-line">Fare <b>₹' + trip.fare + "</b> /ride • " + trip.km.toFixed(1) + " km • ~" + journeyMins(trip.path) + " min • " + (trip.path.length - 1) + " stations" +
      '<br><span style="font-size:11.5px">Towards ' + esc(trip.path[trip.path.length - 1].name) + "</span></div>" +
    '<div class="fare-total"><span>Total (' + trip.pax + (trip.pax > 1 ? " passengers" : " passenger") + (trip.type === "return" ? ", return" : "") + ")</span><b>₹" + trip.total + "</b></div>";
  btn.textContent = "Save trip plan · ₹" + trip.total + " →";
}

function setDepMode(m) { state.booking.depMode = m; renderHome(); }
function changePax(d) {
  state.booking.pax = Math.min(6, Math.max(1, state.booking.pax + d));
  renderHome();
}
function swapStations() {
  const b = state.booking;
  const t = b.from; b.from = b.to; b.to = t;
  renderHome();
}

/* ---------- station picker ---------- */
function openPicker(forWhat) {
  state.pickFor = forWhat;
  $("#pickerTitle").textContent = (forWhat === "from" || forWhat === "postFrom") ? "Select origin" : "Select destination";
  $("#pickerSearch").value = "";
  renderStationList();
  $("#picker").classList.remove("hidden");
  setTimeout(() => { const i = $("#pickerSearch"); if (i) i.focus(); }, 60);
}
function closePicker() { $("#picker").classList.add("hidden"); }
function renderStationList() {
  const q = ($("#pickerSearch").value || "").toLowerCase();
  const list = BLUE_LINE.filter(s => s.name.toLowerCase().includes(q));
  $("#pickerList").innerHTML = list.map(s =>
    '<button class="st-item" onclick="pickStation(\'' + s.name.replace(/'/g, "\\'") + '\')">' +
      '<span class="dot' + (s.br === "V" ? " v" : s.br === "N" ? " n" : "") + '"></span>' +
      "<span style='flex:1'>" + s.name + "</span>" +
      s.ix.map(x => '<span class="ix-pill">' + x + "</span>").join("") +
    "</button>").join("");
}
function pickStation(name) {
  const f = state.pickFor;
  if (f === "from") state.booking.from = name;
  if (f === "to") state.booking.to = name;
  if (f === "postFrom" && state.post) state.post.from = name;
  if (f === "postTo" && state.post) state.post.to = name;
  closePicker();
  if (state.screen === "home") renderHome();
  else if (state.screen === "post") renderPost();
}

/* ---------- payment ---------- */
function startPayment() {
  const trip = bookingTrip();
  if (!trip) { toast("Select From and To stations first"); return; }
  state.payTrip = trip;
  $("#payBody").innerHTML =
    '<div class="pay-route">' + esc(trip.from) + " → " + esc(trip.to) + "</div>" +
    '<div class="pay-amt">₹' + trip.total + "</div>" +
    '<div class="card" style="margin:12px 0"><b>Trip planning only</b><p class="fineprint">Official metro ticket payments are not connected yet. This saves your route in Waymate without charging you.</p></div>' +
    '<button class="btn primary block" onclick="confirmPay()">Save trip plan</button>';
  $("#paywall").classList.remove("hidden");
}
function closePay() { $("#paywall").classList.add("hidden"); state.payTrip = null; }

async function confirmPay() {
  const trip = state.payTrip;
  if (!trip) return;
  $("#payBody").innerHTML = '<div class="pay-processing"><div class="spinner"></div>Saving trip plan…</div>';
  try {
    const result = await api("/api/trips", {
      method: "POST",
      body: JSON.stringify({
        from: trip.from,
        to: trip.to,
        passengers: trip.pax,
        journeyType: trip.type,
        departureAt: new Date(trip.t).toISOString(),
        fareEstimate: trip.total
      })
    });
    state.trips.unshift(result.trip);
    closePay();
    state.lastTicketId = result.trip.id;
    go("ticket");
    toast("Trip plan saved");
  } catch (e) {
    toast(e.message || "Could not save trip plan");
  }
}

/* ---------- ticket ---------- */
function renderTicket() {
  const el = $("#screen-ticket");
  const all = state.trips || [];
  const t = all.find(x => x.id === state.lastTicketId) || all[0];
  if (!t) { el.innerHTML = '<div class="flow-head"><button class="icon-btn" onclick="go(\'home\')">←</button><strong>Trip plan</strong><span></span></div><div class="empty">No saved trips yet — plan your first ride.</div>'; return; }
  el.innerHTML =
    '<div class="flow-head"><button class="icon-btn" onclick="go(\'home\')">←</button><strong>Your trip plan</strong><span></span></div>' +
    '<div class="confirm">🗺️ <div><b>Saved to your account</b><span>This is not an official metro ticket.</span></div></div>' +
    '<div class="ticket' + (t.status === "cancelled" ? " cancelled" : "") + '">' +
      '<div class="t-route"><b>' + esc(t.fromStation) + '</b><span class="t-arrow">⟶</span><b>' + esc(t.toStation) + "</b></div>" +
      '<div class="t-meta">Estimated fare ₹' + t.fareEstimate + " • " + t.passengers + (t.passengers > 1 ? " passengers" : " passenger") + "</div>" +
      '<div class="t-depart">Departure<b>' + fmtTime(new Date(t.departureAt).getTime()) + "</b>" + (t.journeyType === "return" ? ' <span class="badge">Return</span>' : "") + "</div>" +
      '<div class="card" style="margin:14px 0"><b>Official ticketing is not connected</b><span class="muted small">Waymate cannot issue a valid DMRC QR ticket until an authorized ticketing partner is connected.</span></div>' +
      '<div class="t-id">Trip plan #' + t.id + " • " + t.status + "</div>" +
      '<div class="t-status"><span class="badge ' + (t.status === "planned" ? "ok" : "warn") + '">' + t.status + "</span></div>" +
    "</div>" +
    '<div class="btn-row">' +
      '<button class="btn ghost" onclick="go(\'tickets\')">All trip plans</button>' +
      '<button class="btn primary" onclick="go(\'home\')">Plan another</button>' +
    "</div>" +
    (t.status === "planned" ? '<button class="link-danger" onclick="cancelTicket(\'' + t.id + '\')">Cancel trip plan</button>' : "");
}

async function cancelTicket(id) {
  try {
    const result = await api("/api/trips/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled" })
    });
    state.trips = state.trips.map(t => t.id === id ? result.trip : t);
    renderTicket();
    toast("Trip plan cancelled");
  } catch (e) {
    toast(e.message || "Could not cancel trip plan");
  }
}

function renderTickets() {
  const el = $("#screen-tickets");
  const all = state.trips || [];
  el.innerHTML = '<h2 class="page-title">My trip plans</h2>' + (all.length ?
    all.map(t =>
      '<button class="card tk-row" onclick="state.lastTicketId=\'' + t.id + '\';go(\'ticket\')">' +
        '<div class="tk-icon">' + (t.status === "planned" ? "🗺️" : "🚫") + "</div>" +
        '<div class="tk-info"><b>' + esc(t.fromStation) + " → " + esc(t.toStation) + "</b><span>" + fmtTime(new Date(t.departureAt).getTime()) + " • " + t.passengers + " pax • ₹" + t.fareEstimate + "</span></div>" +
        '<span class="badge ' + (t.status === "planned" ? "ok" : "warn") + '">' + t.status + "</span>" +
      "</button>").join("")
    : '<div class="empty">No saved trip plans yet.</div>');
}

function ticketRowsHTML(all) {
  return all.length ? all.map(t =>
    '<button class="card tk-row" onclick="state.lastTicketId=\'' + t.id + '\';go(\'ticket\')">' +
      '<div class="tk-icon">' + (t.status === "planned" ? "🗺️" : "🚫") + "</div>" +
      '<div class="tk-info"><b>' + esc(t.fromStation) + " → " + esc(t.toStation) + "</b><span>" + fmtTime(new Date(t.departureAt).getTime()) + " • " + t.passengers + " pax • ₹" + t.fareEstimate + "</span></div>" +
      '<span class="badge ' + (t.status === "planned" ? "ok" : "warn") + '">' + t.status + "</span>" +
    "</button>").join("") : '<div class="empty profile-empty">No tickets yet — book your first ride! 🚇</div>';
}

/* ================= BUDDY (match & meetup) ================= */
function prefLabel(p) { return p === "male" ? "Men" : p === "female" ? "Women" : "Anyone"; }

function renderBuddy() {
  const el = $("#screen-buddy");
  const post = state.posts.find(p => p.userId === state.user.id) || null;
  let html =
    '<div class="buddy-hero">' +
      '<div class="buddy-kicker">DISCOVER PEOPLE</div>' +
      '<h2>Find people on your route</h2>' +
      '<p>A dating app for your daily commute. Swipe through people sharing your stations, train window and vibe — then say hi before the next stop.</p>' +
      '<div class="buddy-hero-pills"><span>Same route</span><span>Mutual vibes</span><span>Safety built in</span></div>' +
    "</div>";

  if (post) {
    const expired = post.t < Date.now() - 45 * 60000;
    const allMatches = computeMatches(post);
    const matches = allMatches.filter(m => !state.passedMatches.includes(m.post.id));
    html +=
      '<div class="card route-status">' +
        '<div class="row spread"><div class="route-status-label">YOUR LIVE ROUTE</div>' +
          (expired ? '<span class="badge warn">refresh needed</span>' : '<span class="badge ok">matching now</span>') + "</div>" +
        '<div class="route-line"><span class="route-stop">' + esc(post.from) + '</span><span class="route-track"><i></i></span><span class="route-stop right">' + esc(post.to) + "</span></div>" +
        '<div class="route-meta"><span>Departs ' + fmtTime(post.t) + '</span><span>' + (expired ? "Trip ended" : matches.length + " people nearby") + "</span></div>" +
        '<div class="route-preference">Looking for: <b>' + prefLabel(post.pref) + "</b>" + (post.note ? " · “" + esc(post.note) + "”" : "") + "</div>" +
        '<div class="route-actions"><button class="btn ghost small-btn" onclick="go(\'post\')">Change route</button><button class="btn danger small-btn" onclick="deleteRoute()">Delete route</button></div>' +
      "</div>";
    html += matches.length ?
      '<div class="deck-heading"><div><b>People on your route</b><span>Sorted by route chemistry</span></div><strong>' + matches.length + " left</strong></div>" +
      matchCard(matches[0]) +
      (matches.length > 1 ? '<div class="deck-hint">Swipe right to like and chat, swipe left to pass. Route overlap and safety come first.</div>' : "") :
      '<div class="card deck-empty"><div class="deck-empty-icon">✦</div><b>You’ve seen everyone on this route</b><span>Change your departure time or route to discover more people.</span><button class="btn primary block" onclick="go(\'post\')">Try another trip</button></div>';
  } else {
    html +=
      '<div class="card buddy-start">' +
        '<div class="start-orbit"><span>🚇</span><i></i><span>♡</span></div>' +
        '<div class="start-eyebrow">YOUR COMMUTE = YOUR MATCHMAKER</div>' +
        "<h3>Who’s your type on the Blue Line?</h3>" +
        '<p>Set your route and departure time. We’ll surface people you could genuinely bump into — same stations, same train window, same city energy.</p>' +
        '<button class="btn primary block" onclick="go(\'post\')" style="margin-bottom:0">Start swiping my route →</button>' +
      "</div>" +
      '<div class="route-proof">' +
        '<div><span class="proof-icon">01</span><div><b>Same route, better odds</b><small>Only see profiles whose paths actually overlap.</small></div></div>' +
        '<div><span class="proof-icon">02</span><div><b>Match by timing</b><small>Find someone you could actually meet on the train.</small></div></div>' +
        '<div><span class="proof-icon">03</span><div><b>Chat before the stop</b><small>Say hi first and meet only in public places.</small></div></div>' +
      "</div>";
  }
   html += '<div class="safety-note">🛡️ <b>Safety first:</b> verified ✔ badges, meet near the DMRC staff / CCTV area, share live location with family, and report anything odd. Never share OTPs or money.</div>';
  el.innerHTML = html;
  setupSwipeCard();
}

function computeMatches(post) {
  const me = state.user;
  const myGenderWord = me.gender === "M" ? "male" : me.gender === "F" ? "female" : "";
  const mySet = new Set(pathBetween(post.from, post.to).map(s => s.name));
  const out = [];
  const allPosts = state.posts;
  for (const p of allPosts) {
    if (p.userId === state.user.id) continue;
    const owner = p.owner;
    if (!owner) continue;
    if (post.pref !== "any" && post.pref !== owner.gender.toLowerCase()) continue;
    if (p.pref !== "any" && p.pref !== myGenderWord) continue;
    const dt = Math.abs(p.t - post.t) / 60000;
    if (dt > 45) continue;
    const theirPath = pathBetween(p.from, p.to);
    const overlap = theirPath.filter(s => mySet.has(s.name)).length;
    if (overlap === 0) continue;
    let score = 55 + Math.min(overlap * 3, 22) + Math.round((45 - dt) / 45 * 18);
    if (p.from === post.from && p.to === post.to) score += 10;
    out.push({ post: p, owner, score: Math.min(score, 98), overlap, dt: Math.round(dt), shared: theirPath.filter(s => mySet.has(s.name)) });
  }
  return out.sort((a, b) => b.score - a.score);
}

function matchCard(m) {
  const u = m.owner;
  const dir = pathBetween(m.post.from, m.post.to).slice(-1)[0].name;
  const shared = (m.shared || []).slice(0, 4).map(s => '<span>' + esc(s.name) + "</span>").join("");
  return '<div class="match-card swipe-card" data-match-id="' + esc(m.post.id) + '">' +
    '<div class="swipe-stamp like-stamp">LIKE</div><div class="swipe-stamp pass-stamp">PASS</div>' +
    '<div class="match-card-topline"><span class="match-label">ROUTE MATCH</span><span class="match-window">in ' + minsUntil(m.post.t) + " min</span></div>" +
    '<div class="match-top">' +
      avatarHTML(u, 70) +
      '<div class="match-id"><b>' + esc(u.name) + ", " + u.age + (u.verified ? ' <span class="vf">✔ verified</span>' : "") + "</b>" +
      '<span class="muted">' + esc(u.bio || "") + "</span></div>" +
      '<div class="match-score"><b>' + m.score + '%</b><span>fit</span></div>' +
    "</div>" +
    '<div class="match-route"><span>' + esc(m.post.from) + "</span><i>→</i><span>" + esc(m.post.to) + "</span></div>" +
    '<div class="match-sub">You share ' + m.overlap + " station" + (m.overlap > 1 ? "s" : "") + " • " + (m.dt ? m.dt + " min apart" : "same departure") + " • towards " + esc(dir) + "</div>" +
    '<div class="shared-stations"><small>YOUR ROUTE OVERLAPS HERE</small><div>' + shared + "</div></div>" +
    '<div class="match-actions deck-actions">' +
      '<button class="deck-action pass" aria-label="Pass on ' + esc(u.name) + '" onclick="skipMatch(\'' + m.post.id + '\')">×<span>Pass</span></button>' +
      '<button class="btn ' + (isBuddy(u.id) ? 'ghost' : hasOutgoing(u.id) ? 'ghost' : 'primary') + ' connect-btn" onclick="' + (isBuddy(u.id) ? 'openChat(\'' + u.id + '\')' : hasOutgoing(u.id) ? 'cancelBuddyRequest(\'' + u.id + '\')' : 'sendBuddyRequest(\'' + u.id + '\')') + '">' + (isBuddy(u.id) ? 'Message buddy' : hasOutgoing(u.id) ? 'Request sent · Cancel' : 'Add buddy →') + '</button>' +
    "</div>" +
      '<button class="link-danger" onclick="reportUser(\'' + esc(u.id) + '\')">Something feel off? Report</button>' +
  "</div>";
}

function setupSwipeCard() {
  const card = $(".swipe-card");
  if (!card || card.dataset.swipeReady) return;
  card.dataset.swipeReady = "1";
  let startX = 0, currentX = 0, dragging = false;
  card.addEventListener("pointerdown", e => {
    if (e.target.closest("button, a, input")) return;
    dragging = true;
    startX = e.clientX;
    currentX = 0;
    card.setPointerCapture(e.pointerId);
    card.classList.add("is-dragging");
  });
  card.addEventListener("pointermove", e => {
    if (!dragging) return;
    currentX = e.clientX - startX;
    card.style.transform = "translateX(" + currentX + "px) rotate(" + (currentX / 16) + "deg)";
    card.classList.toggle("swiping-right", currentX > 35);
    card.classList.toggle("swiping-left", currentX < -35);
  });
  card.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("is-dragging");
    if (Math.abs(currentX) > 95) {
      const id = card.dataset.matchId;
      if (currentX > 0) {
        const match = computeMatches(state.posts.find(p => p.userId === state.user.id)).find(m => m.post.id === id);
        if (match) { card.classList.add("swipe-away-right"); setTimeout(() => openChat(match.owner.id), 180); }
      } else {
        card.classList.add("swipe-away-left");
        setTimeout(() => skipMatch(id), 180);
      }
    } else {
      card.style.transform = "";
    }
    card.classList.remove("swiping-right", "swiping-left");
  });
  card.addEventListener("pointercancel", () => {
    dragging = false;
    card.style.transform = "";
    card.classList.remove("is-dragging", "swiping-right", "swiping-left");
  });
}

function skipMatch(id) {
  if (!state.passedMatches.includes(id)) state.passedMatches.push(id);
  renderBuddy();
  toast("Passed — showing the next route match");
}

async function deleteRoute() {
  if (!confirm("Delete your active route and stop matching?")) return;
  const post = state.posts.find(p => p.userId === state.user.id);
  if (!post) return;
  try {
    await api("/api/posts/" + encodeURIComponent(post.id), { method: "DELETE" });
    state.posts = state.posts.filter(p => p.id !== post.id);
    state.post = null;
    state.passedMatches = [];
    toast("Route deleted — matching is paused");
    go("buddy");
  } catch (e) {
    toast(e.message || "Could not delete route");
  }
}

function renderPost() {
  if (!state.post) {
    const last = state.posts.find(post => post.userId === state.user.id) || {};
    const lastTrip = state.trips[0] || {};
    state.post = {
      from: last.from || last.fromStation || lastTrip.from || lastTrip.fromStation || "",
      to: last.to || last.toStation || lastTrip.to || lastTrip.toStation || "",
      when: "30", customTime: "",
      pref: "any", note: last.note || ""
    };
  }
  const p = state.post;
  $("#screen-post").innerHTML =
    '<div class="flow-head"><button class="icon-btn" onclick="go(\'buddy\')">←</button><strong>Post your trip</strong><span></span></div>' +
    '<div class="card">' +
      '<label class="field"><span>From</span><div class="select-like' + (p.from ? "" : " placeholder") + '" onclick="openPicker(\'postFrom\')">' + (p.from ? esc(p.from) : "Select station") + "</div></label>" +
      '<label class="field"><span>To</span><div class="select-like' + (p.to ? "" : " placeholder") + '" onclick="openPicker(\'postTo\')">' + (p.to ? esc(p.to) : "Select station") + "</div></label>" +
      '<span class="field-label">Departure</span>' +
      '<div class="chips">' +
        ["15", "30", "60"].map(w => '<button class="chip ' + (p.when === w ? "on" : "") + '" onclick="state.post.when=\'' + w + '\';renderPost()">in ' + w + " min</button>").join("") +
        '<button class="chip ' + (p.when === "custom" ? "on" : "") + '" onclick="state.post.when=\'custom\';renderPost()">⏰ time</button>' +
      "</div>" +
      (p.when === "custom" ? '<input type="time" class="input" style="margin-bottom:12px" value="' + esc(p.customTime) + '" onchange="state.post.customTime=this.value" />' : "") +
      '<span class="field-label">Looking to travel with</span>' +
      '<div class="chips">' +
        [["any", "Anyone"], ["male", "Men"], ["female", "Women"]].map(x =>
          '<button class="chip ' + (p.pref === x[0] ? "on" : "") + '" onclick="state.post.pref=\'' + x[0] + '\';renderPost()">' + x[1] + "</button>").join("") +
      "</div>" +
      '<label class="field"><span>Note (optional)</span>' +
        '<input class="input" maxlength="80" placeholder="e.g. first coach, up for chai ☕" value="' + esc(p.note) + '" oninput="state.post.note=this.value" /></label>' +
      '<button class="btn primary block" style="margin-bottom:0" onclick="savePost()">Post &amp; find matches →</button>' +
    "</div>";
}

async function savePost() {
  const p = state.post;
  if (!p.from || !p.to || p.from === p.to) { toast("Select From and To stations"); return; }
  let t;
  if (p.when === "custom") {
    const parts = (p.customTime || "").split(":").map(Number);
    if (isNaN(parts[0])) { toast("Pick a departure time"); return; }
    const d = new Date(); d.setHours(parts[0], parts[1] || 0, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    t = d.getTime();
  } else {
    t = Date.now() + Number(p.when) * 60000;
  }
  try {
    const result = await api("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        from: p.from,
        to: p.to,
        departureAt: new Date(t).toISOString(),
        preference: p.pref,
        note: (p.note || "").trim()
      })
    });
    state.posts = [postFromApi(Object.assign({}, result.post, { userId: state.user.id, user: state.user })), ...state.posts.filter(post => post.userId !== state.user.id)];
    state.post = null;
    go("buddy");
    toast("Trip posted");
  } catch (e) {
    toast(e.message || "Could not post your trip");
  }
}

function openChatOptions(id) {
  const u = (state.connections.find(c => c.otherUserId === id) || {}).user || state.chatWith;
  if (!u) return;
  $("#chatOptionsBody").innerHTML = '<div class="options-list">' +
    '<button class="option-row" onclick="toast(\'Notifications muted for this chat\');closeChatOptions()">🔕<span><b>Mute notifications</b><small>Stop alerts for this conversation</small></span></button>' +
    '<button class="option-row" onclick="openChat(\'' + u.id + '\');closeChatOptions()">👤<span><b>View profile</b><small>See ' + esc(u.name) + '\'s profile</small></span></button>' +
    '<button class="option-row" onclick="closeChatOptions();toast(\'Messages are stored securely on the server\')">🧹<span><b>Clear chat</b><small>Message deletion is not available yet</small></span></button>' +
    '</div>';
  $("#chatOptionsModal").classList.remove("hidden");
}
function closeChatOptions() { $("#chatOptionsModal").classList.add("hidden"); }

function openPeopleSearch() {
  state.searchResults = [];
  state.searchReturn = state.screen === "buddies" ? "buddies" : "buddy";
  go("search");
  setTimeout(() => $("#peopleSearchInput").focus(), 60);
}

function closePeopleSearch() {
  const modal = $("#peopleSearchModal");
  if (modal) modal.classList.add("hidden");
  if (state.screen === "search") go(state.searchReturn || "buddies");
}

function renderPeopleSearch() {
  const el = $("#screen-search");
  el.innerHTML =
    '<div class="search-page">' +
      '<div class="search-page-head">' +
        '<button class="search-back" onclick="closePeopleSearch()" aria-label="Back">‹</button>' +
        '<div><div class="search-kicker">DISCOVER YOUR COMMUNITY</div><h2>Search</h2></div>' +
        '<span class="search-page-mark">⌕</span>' +
      '</div>' +
      '<div class="instagram-search">' +
        '<span class="instagram-search-icon">⌕</span>' +
        '<input id="peopleSearchInput" placeholder="Search people" autocomplete="off" oninput="schedulePeopleSearch()" onkeydown="if(event.key===\'Enter\')searchPeople();if(event.key===\'Escape\')closePeopleSearch()" />' +
        '<button class="search-clear hidden" id="peopleSearchClear" onclick="clearPeopleSearch()" aria-label="Clear search">×</button>' +
      '</div>' +
      '<p class="search-page-note">Find commuters by name or something in their profile bio.</p>' +
      '<div id="peopleSearchResults" class="people-search-results"><div class="search-empty">Start typing to find people on your route.</div></div>' +
    '</div>';
}

function clearPeopleSearch() {
  const input = $("#peopleSearchInput");
  if (!input) return;
  input.value = "";
  state.searchResults = [];
  $("#peopleSearchClear").classList.add("hidden");
  $("#peopleSearchResults").innerHTML = '<div class="search-empty">Start typing to find people on your route.</div>';
}

function schedulePeopleSearch() {
  const input = $("#peopleSearchInput");
  const clear = $("#peopleSearchClear");
  if (!input) return;
  clear.classList.toggle("hidden", !(input.value || "").trim());
  clearTimeout(state.searchDebounce);
  const query = (input.value || "").trim();
  if (!query) {
    state.searchResults = [];
    $("#peopleSearchResults").innerHTML = '<div class="search-empty">Start typing to find people on your route.</div>';
    return;
  }
  if (query.length < 2) {
    $("#peopleSearchResults").innerHTML = '<div class="search-empty">Type at least 2 characters to search.</div>';
    return;
  }
  $("#peopleSearchResults").innerHTML = '<div class="search-empty">Searching…</div>';
  state.searchDebounce = setTimeout(() => searchPeople(), 300);
}

async function searchPeople() {
  const input = $("#peopleSearchInput");
  const query = (input.value || "").trim();
  if (query.length < 2) {
    $("#peopleSearchResults").innerHTML = '<div class="search-empty">Type at least 2 characters to search.</div>';
    return;
  }
  $("#peopleSearchResults").innerHTML = '<div class="search-empty">Searching…</div>';
  try {
    const result = await api("/api/people/search?q=" + encodeURIComponent(query));
    state.searchResults = (result.users || []).map(profileFromApi);
    renderSearchResults();
  } catch (e) {
    $("#peopleSearchResults").innerHTML = '<div class="search-empty">' + esc(e.message || "Could not search people") + "</div>";
  }
}

function searchUserAction(user) {
  if (isBuddy(user.id)) {
    return '<button class="btn ghost small-btn" onclick="openChat(\'' + esc(user.id) + '\')">Message</button>';
  }
  if (hasIncoming(user.id)) {
    return '<button class="btn primary small-btn" onclick="acceptBuddy(\'' + esc(user.id) + '\')">Accept</button>';
  }
  if (hasOutgoing(user.id)) {
    return '<button class="btn ghost small-btn" onclick="cancelBuddyRequest(\'' + esc(user.id) + '\')">Sent</button>';
  }
  return '<button class="btn primary small-btn" onclick="sendBuddyRequest(\'' + esc(user.id) + '\')">Add</button>';
}

function renderSearchResults() {
  const results = state.searchResults || [];
  $("#peopleSearchResults").innerHTML = results.length
    ? results.map(user =>
      '<div class="search-result">' +
        avatarHTML(user, 42) +
        '<div class="search-result-info"><b>' + esc(user.name) + ', ' + user.age + '</b><span>' + esc(user.bio || "Waymate commuter") + '</span></div>' +
        searchUserAction(user) +
      '</div>'
    ).join("")
    : '<div class="search-empty">No people found. Try a different name or bio keyword.</div>';
}

/* ---------- chat ---------- */
function openChat(userId) {
  const connection = state.connections.find(c => c.otherUserId === userId);
  state.chatWith = connection && connection.user;
  state.chatReturn = state.screen === "buddies" ? "buddies" : state.screen === "search" ? "search" : "buddy";
  state.messages = [];
  go("chat");
  api("/api/messages/" + encodeURIComponent(userId))
    .then(result => {
      state.messages = result.messages || [];
      renderChat();
    })
    .catch(e => toast(e.message || "Could not load messages"));
}

function renderChat() {
  const u = state.chatWith;
  if (!u) { go(state.chatReturn || "buddy"); return; }
  markChatRead(u.id);
  const msgs = state.messages || [];
  $("#screen-chat").innerHTML =
    '<div class="flow-head chat-head">' +
      '<button class="icon-btn" onclick="go(state.chatReturn || \'buddy\')">←</button>' +
      avatarHTML(u, 36) +
      '<div class="chat-who"><b>' + esc(u.name) + (u.verified ? ' <span class="vf">✔</span>' : "") + '</b><span class="muted small">' + esc(u.bio || "") + "</span></div>" +
    "</div>" +
    '<div class="chat-wrap" id="chatWrap">' +
      '<div class="chat-note">You matched on a Blue Line trip. Meet near the station staff / CCTV area 👍</div>' +
      msgs.map(m => '<div class="bubble ' + (m.senderId === state.user.id ? "me" : "") + '">' + esc(m.body) + "<i>" + fmtTime(new Date(m.createdAt).getTime()) + "</i></div>").join("") +
    "</div>" +
    '<div class="chat-options-row"><button class="icon-btn chat-more" onclick="openChatOptions(\'' + u.id + '\')" title="More options">•••</button></div>' +
    '<div class="chat-bar">' +
      '<input class="input" id="chatInput" placeholder="Message…" onkeydown="if(event.key===\'Enter\')sendMsg()" />' +
      '<button class="btn primary" onclick="sendMsg()">➤</button>' +
    "</div>";
  const w = $("#chatWrap");
  if (w) w.scrollTop = w.scrollHeight;
}

async function sendMsg() {
  const inp = $("#chatInput");
  const text = (inp.value || "").trim();
  if (!text) return;
  try {
    const result = await api("/api/messages/" + encodeURIComponent(state.chatWith.id), {
      method: "POST",
      body: JSON.stringify({ body: text })
    });
    state.messages.push(result.message);
    inp.value = "";
    renderChat();
  } catch (e) {
    toast(e.message || "Could not send message");
  }
}

/* ================= SOCIAL GRAPH ================= */
function socialState() {
  return {
    buddies: state.connections.filter(c => c.status === "accepted").map(c => c.otherUserId),
    incoming: state.connections.filter(c => c.status === "pending" && c.direction === "incoming").map(c => c.otherUserId),
    outgoing: state.connections.filter(c => c.status === "pending" && c.direction === "outgoing").map(c => c.otherUserId)
  };
}
function isBuddy(id) { return socialState().buddies.includes(id); }
function hasIncoming(id) { return socialState().incoming.includes(id); }
function hasOutgoing(id) { return socialState().outgoing.includes(id); }
async function sendBuddyRequest(id) {
  const s = socialState();
  if (s.buddies.includes(id)) { toast("You’re already buddies"); return; }
  if (s.incoming.includes(id)) { acceptBuddy(id); return; }
  if (s.outgoing.includes(id)) { toast("Request already sent"); return; }
  try {
    await api("/api/connections/" + encodeURIComponent(id), { method: "POST" });
    await loadConnections();
    if (state.screen === "search") renderSearchResults();
    else renderBuddy();
    const searchModal = $("#peopleSearchModal");
    if (searchModal && !searchModal.classList.contains("hidden")) renderSearchResults();
    toast("Buddy request sent");
  } catch (e) {
    toast(e.message || "Could not send buddy request");
  }
}
async function updateConnection(id, status, message) {
  const connection = state.connections.find(c => c.otherUserId === id);
  if (!connection) return;
  try {
    await api("/api/connections/" + encodeURIComponent(connection.id), {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await loadConnections();
    if (state.screen === "search") renderSearchResults();
    else renderBuddies();
    const searchModal = $("#peopleSearchModal");
    if (searchModal && !searchModal.classList.contains("hidden")) renderSearchResults();
    toast(message);
  } catch (e) {
    toast(e.message || "Could not update connection");
  }
}
function acceptBuddy(id) { return updateConnection(id, "accepted", "You’re buddies now"); }
function declineBuddy(id) { return updateConnection(id, "declined", "Request removed"); }
function cancelBuddyRequest(id) { return updateConnection(id, "cancelled", "Request cancelled"); }
function removeBuddy(id) {
  const connection = state.connections.find(c => c.otherUserId === id);
  const u = connection && connection.user;
  if (!confirm("Remove " + (u ? u.name : "this buddy") + "?")) return;
  return updateConnection(id, "cancelled", "Buddy removed");
}
function setSocialTab(tab) { state.socialTab = tab; renderBuddies(); }
function socialUserCard(u, mode) {
  const isFriend = isBuddy(u.id);
  let action = '';
  if (mode === "incoming") action = '<button class="btn ghost small-btn" onclick="declineBuddy(\'' + u.id + '\')">Delete</button><button class="btn primary small-btn" onclick="acceptBuddy(\'' + u.id + '\')">Confirm</button>';
  else if (mode === "outgoing") action = '<button class="btn ghost small-btn" onclick="cancelBuddyRequest(\'' + u.id + '\')">Cancel request</button>';
  else if (mode === "inbox") action = '<button class="btn primary small-btn" onclick="openChat(\'' + u.id + '\')">Open chat</button>';
  else if (mode === "inbox") action = '<button class="btn primary small-btn" onclick="openChat(\'' + u.id + '\')">Open chat</button>';
  else action = '<button class="btn ghost small-btn" onclick="openChat(\'' + u.id + '\')">💬 Message</button><button class="icon-btn" onclick="removeBuddy(\'' + u.id + '\')" title="Remove buddy">•••</button>';
  const subtitle = mode === "incoming" ? "Wants to connect with you" : mode === "outgoing" ? "Request sent" : isFriend ? "Buddies • connected" : "Blue Line community";
  return '<div class="card friend-card"><div class="friend-top">' + avatarHTML(u, 52) + '<div class="friend-id"><b>' + esc(u.name) + (u.verified ? ' <span class="vf">✔</span>' : '') + '</b><span>' + subtitle + '</span><small>' + esc(u.bio || '') + '</small></div><span class="friend-dot">' + (isFriend ? '●' : '○') + '</span></div>' +
    '<div class="friend-route"><span>🚇 Blue Line</span><span>•</span><span>Route match</span></div>' +
    '<div class="friend-actions">' + action + '</div></div>';
}

/* ================= BUDDIES ================= */
function renderBuddies() {
  const el = $("#screen-buddies");
  const s = socialState();
  const tab = state.socialTab || "buddies";
  const buddies = state.connections.filter(c => c.status === "accepted").map(c => c.user).filter(Boolean);
  const incoming = state.connections.filter(c => c.status === "pending" && c.direction === "incoming").map(c => c.user).filter(Boolean);
  const list = tab === "requests" ? incoming : buddies;
  const mode = tab === "requests" ? "incoming" : "buddies";
  const empty = tab === "requests" ? "No new requests — discover people from your route." : "Add people from Discover to build your buddy list.";
  el.innerHTML =
    '<div class="buddy-page-head"><div><div class="buddy-kicker">YOUR SOCIAL CIRCLE</div><h2>Buddies</h2><p>Message your connections after you both accept. Just like a close-friends chat.</p></div><div class="buddy-page-icon">🫂</div></div>' +
    '<div class="friend-tabs"><button class="friend-tab ' + (tab === "buddies" ? "active" : "") + '" onclick="setSocialTab(\'buddies\')">Buddies <span>' + buddies.length + '</span></button><button class="friend-tab ' + (tab === "requests" ? "active" : "") + '" onclick="setSocialTab(\'requests\')">Requests ' + (incoming.length ? '<span>' + incoming.length + '</span>' : '') + '</button><button class="friend-search-btn" onclick="openPeopleSearch()" title="Search people">⌕ Search</button></div>' +
    (list.length ? '<div class="friend-list">' + list.map(u => socialUserCard(u, mode)).join("") + '</div>' : '<div class="empty friend-empty">' + empty + '</div>') +
    '<div class="safety-note">🛡️ <b>Your control:</b> requests must be accepted before messaging. You can remove a buddy anytime.</div>';
}

function openSettings() {
  const body = $("#settingsBody");
  const notifications = store.get("notifications", true);
  body.innerHTML = '<div class="settings-list">' +
    '<button class="settings-row" onclick="toast(\'Notifications are ' + (notifications ? 'on' : 'off') + '\')"><span>🔔<b>Notifications</b><small>Request and message alerts</small></span><span class="settings-value">' + (notifications ? 'On' : 'Off') + '</span></button>' +
    '<button class="settings-row" onclick="store.set(\'notifications\', !store.get(\'notifications\', true));openSettings();toast(\'Notification preference updated\')"><span>🔕<b>Toggle notifications</b><small>Change your notification preference</small></span><span>›</span></button>' +
    '<button class="settings-row" onclick="openSafety();closeSettings()"><span>🛡️<b>Safety and privacy</b><small>Review meeting and reporting guidance</small></span><span>›</span></button>' +
    '<button class="settings-row" onclick="toast(\'Your Waymate data is stored on the server\')"><span>💾<b>Data and storage</b><small>Account data is server-backed</small></span><span>›</span></button>' +
    '<button class="settings-row" onclick="logout()"><span>↪<b>Log out</b><small>Sign out of this Waymate account</small></span><span>›</span></button>' +
    '</div>' +
    '<p class="fineprint center">Waymate • server-backed account</p>';
  $("#settingsModal").classList.remove("hidden");
}
function closeSettings() { $("#settingsModal").classList.add("hidden"); }

function logout() {
  if (!confirm("Log out of Waymate?")) return;
  window.parent.postMessage({ type: "waymate:logout" }, window.location.origin);
}

function openProfileEditor() {
  const u = state.user || {};
  $("#profileEditBody").innerHTML = '<div class="profile-photo-edit">' + avatarHTML(u, 88) + '<div class="photo-actions"><label class="btn ghost small-btn">Edit profile photo<input type="file" accept="image/*" style="display:none" onchange="handleProfilePhoto(this)" /></label>' + (u.photo ? '<button class="btn danger small-btn" onclick="removeProfilePhoto()">Remove photo</button>' : '') + '</div></div>' + '<label class="field"><span>Full name</span><input id="editName" class="input" value="' + esc(u.name || '') + '" /></label>' +
    '<label class="field"><span>Age</span><input id="editAge" class="input" type="number" min="10" max="120" value="' + esc(u.age || '') + '" /></label>' +
    '<label class="field"><span>Bio</span><textarea id="editBio" class="input" maxlength="120" rows="3" placeholder="Tell people about your commute…">' + esc(u.bio || '') + '</textarea></label>' +
    '<button class="btn primary block" onclick="saveProfileEdits()">Save profile</button>';
  $("#profileEditModal").classList.remove("hidden");
}
function closeProfileEditor() { $("#profileEditModal").classList.add("hidden"); }
async function removeProfilePhoto() {
  const u = state.user;
  try {
    const result = await api("/api/profile", {
      method: "PUT",
      body: JSON.stringify({
        name: u.name,
        age: u.age,
        gender: u.gender,
        bio: u.bio || "",
        photo: null
      })
    });
    state.user = profileFromApi(result.user);
    openProfileEditor();
    if (state.screen === "profile") renderProfile();
    toast("Profile photo removed");
  } catch (e) {
    toast(e.message || "Could not remove profile photo");
  }
}

function handleProfilePhoto(input) {
  const f = input.files && input.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = 256; c.height = 256;
      const ctx = c.getContext("2d"); const min = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width-min)/2, (img.height-min)/2, min, min, 0, 0, 256, 256);
      state.user = Object.assign({}, state.user, { photo: c.toDataURL("image/jpeg", 0.85) });
      openProfileEditor(); toast("Profile photo ready to save");
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(f);
}

async function saveProfileEdits() {
  const name = ($("#editName").value || '').trim();
  const age = Number($("#editAge").value);
  if (name.length < 3) { toast("Enter a valid name"); return; }
  if (!age || age < 10 || age > 120) { toast("Enter an age between 10 and 120"); return; }
  const next = Object.assign({}, state.user, { name, age, bio: ($("#editBio").value || '').trim() });
  try {
    const result = await api("/api/profile", {
      method: "PUT",
      body: JSON.stringify({
        name: next.name,
        age: next.age,
        gender: next.gender,
        bio: next.bio,
        photo: next.photo || null
      })
    });
    state.user = profileFromApi(result.user);
    closeProfileEditor();
    renderProfile();
    toast("Profile updated");
  } catch (e) {
    toast(e.message || "Could not update profile");
  }
}

/* ================= PROFILE ================= */
function renderProfile() {
  const el = $("#screen-profile");
  const u = state.user;
  const tickets = state.trips || [];
  const chats = state.connections.filter(c => c.status === "accepted").length;
  el.innerHTML =
    '<h2 class="page-title">Profile</h2>' +
    '<div class="card profile-card">' +
      avatarHTML(u, 72) +
      "<div><b class='p-name'>" + esc(u.name) + ' <span class="vf">✔</span></b>' +
      '<div class="muted">' + (u.gender === "M" ? "Male" : u.gender === "F" ? "Female" : "Other") + " • " + u.age + " yrs</div>" +
      '<div class="muted small">' + esc(u.contact || "") + "</div>" + (u.bio ? '<div class="muted small profile-bio">' + esc(u.bio) + '</div>' : '') + "</div>" +
      '<button class="icon-btn profile-edit-icon" onclick="openProfileEditor()" title="Edit profile">✎</button>' +
    "</div>" +
    '<div class="stats">' +
      '<div class="stat"><b>' + tickets.length + "</b><span>trip plans</span></div>" +
      '<div class="stat"><b>₹' + tickets.reduce((s, t) => s + t.fareEstimate, 0) + "</b><span>estimated fares</span></div>" +
      '<div class="stat"><b>' + chats + "</b><span>buddy chats</span></div>" +
    "</div>" +
    '<div class="profile-section-head"><h3>Trip plans</h3><span>' + tickets.length + ' total</span></div>' +
    '<div class="profile-tickets">' + ticketRowsHTML(tickets.slice().reverse().slice(0, 3)) + '</div>' +
    (tickets.length > 3 ? '<button class="btn ghost block" onclick="go(\'tickets\')">View all trip plans</button>' : '') +
    '<div class="profile-actions"><button class="btn ghost" onclick="openProfileEditor()">✎ Edit profile</button><button class="btn ghost" onclick="openSettings()">⚙ Settings</button></div>' +
    '<button class="btn ghost block" onclick="openSafety()">🛡️ Safety tips</button>' +
    '<p class="fineprint center">Waymate • unofficial metro companion<br>Not affiliated with DMRC • fares are approximate</p>';
}

function openSafety() { $("#safetyModal").classList.remove("hidden"); }
function closeSafety() { $("#safetyModal").classList.add("hidden"); }

async function loadConnections() {
  const result = await api("/api/connections");
  state.connections = (result.connections || []).map(connection => Object.assign({}, connection, {
    user: profileFromApi(connection.user)
  }));
}

async function loadServerState() {
  const [postsResult, tripsResult] = await Promise.all([
    api("/api/posts"),
    api("/api/trips")
  ]);
  state.posts = (postsResult.posts || []).map(postFromApi);
  state.trips = tripsResult.trips || [];
  await loadConnections();
}

/* ================= init ================= */
(async function init() {
  try {
    const result = await api("/api/me");
    state.user = profileFromApi(result.user);
    if (!state.user) {
      const embeddedAuthenticated = new URLSearchParams(location.search).get("embedded") === "authenticated";
      if (!embeddedAuthenticated) {
        state.reg = { step: 2, contact: "", name: "", gender: "", age: "", photo: null };
        go("auth");
        return;
      }
      // The root shell has already authenticated this session. Keep the app
      // usable immediately and let users complete their profile later.
      state.user = null;
      state.reg = null;
      go("auth");
    } else {
      await loadServerState();
      startRealtimeMessages();
      go("buddy");
    }
  } catch (e) {
    const embeddedAuthenticated = new URLSearchParams(location.search).get("embedded") === "authenticated";
    if (embeddedAuthenticated) {
      state.user = null;
      state.reg = null;
      go("auth");
    } else {
      state.user = null;
      $("#screen-auth").innerHTML = '<div class="empty">Your account session could not be loaded. Please return to the Waymate sign-in screen and try again.</div>';
      go("auth");
    }
  } finally {
    state.loading = false;
    updateTabBadges();
  }
})();
