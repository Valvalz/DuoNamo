import * as THREE from "three";

const socket = io(window.DUOVERSE_SERVER_URL || undefined);
const $ = id => document.getElementById(id);
const lobby = $("lobby"), gameScreen = $("gameScreen");
let roomCode = null, myId = null, myName = "Visitante", money = 100, taskCount = 0;
let scene, camera, renderer, clock, houseGroup;
let localAvatar = null;
const avatars = new Map();
const targetPositions = new Map();
let moveVector = { x: 0, z: 0 };
let cameraAngle = 0;
let draggingCamera = false, lastPointerX = 0;
let toastTimer = null;
let pendingRoomState = null;
let pendingPlacement = null, renderedHouseLevel = -1;
const placedItems = new Map();
const outfitColors = {
  lavender: "#8b5cf6",
  pink: "#f472b6",
  blue: "#38bdf8",
  green: "#34d399",
  sunshine: "#facc15"
};
let selectedCharacterType = "male";
let selectedOutfit = "lavender";

function setMessage(message) { $("lobbyMessage").textContent = message || ""; }
function showToast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function getName() {
  const input = $("playerName").value.trim();
  return input ? input.slice(0, 18) : "Visitante";
}
function startJoin(code, name, create) {
  setMessage("Conectando...");
  const event = create ? "create-room" : "join-room";
  const appearance = { characterType: selectedCharacterType, outfit: selectedOutfit };
  socket.emit(event, create ? { name, ...appearance } : { code, name, ...appearance }, result => {
    if (!result?.ok) { setMessage(result?.error || "Não foi possível entrar."); return; }
    roomCode = result.code; myId = result.playerId; myName = name;
    history.replaceState({}, "", `${location.pathname}?room=${encodeURIComponent(roomCode)}`);
    lobby.classList.add("hidden"); gameScreen.classList.remove("hidden");
    $("roomLabel").textContent = `Sala ${roomCode}`;
    $("welcomePill").textContent = `Bem-vindo(a), ${myName}!`;
    if (!renderer) init3D();
    socket.emit("request-state");
    showToast(create ? "Sala criada! Compartilhe o convite com sua namorada 💗" : "Você entrou no mundinho! 💗");
  });
}
$("createBtn").addEventListener("click", () => startJoin("", getName(), true));
$("joinBtn").addEventListener("click", () => {
  const code = $("roomCode").value.trim().toUpperCase();
  if (!code) return setMessage("Digite o código da sala.");
  startJoin(code, getName(), false);
});
$("roomCode").addEventListener("input", e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6));
$("shareBtn").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(roomCode)}`;
  const text = `Vem jogar comigo no nosso mundinho DuoVerse ❤️ ${url}`;
  try {
    if (navigator.share) await navigator.share({ title: "Nosso DuoVerse ❤️", text, url });
    else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); showToast("Convite copiado! Envie pelo WhatsApp 💌"); }
    else window.prompt("Copie este link e envie para sua namorada:", url);
  } catch (e) { if (e.name !== "AbortError") showToast("Compartilhe este link: " + url); }
});
$("leaveBtn").addEventListener("click", () => {
  location.href = location.pathname;
});
$("homeBtn").addEventListener("click", () => {
  if (localAvatar) { localAvatar.position.set(-1.2, 0, 4.2); moveVector = {x:0,z:0}; sendPosition(); }
  showToast("Você voltou para perto de casa 🏡");
});
document.querySelectorAll(".task-button").forEach(button => {
  button.addEventListener("click", () => {
    socket.emit("do-task", { task: button.dataset.task }, result => {
      if (!result?.ok) return showToast(result?.error || "Não foi possível concluir a tarefa.");
      $("taskMessage").textContent = `Muito bem! +${result.reward} moedas 🪙`;
      showToast(`Tarefa concluída! Você ganhou ${result.reward} moedas.`);
    });
  });
});
function setPanelTab(tab) {
  const panels = {
    activities: ["activitiesTab", "activitiesPanel"],
    shop: ["shopTab", "shopPanel"],
    character: ["characterTab", "characterPanel"]
  };
  for (const [key, [tabId, panelId]] of Object.entries(panels)) {
    const selected = tab === key;
    $(panelId).classList.toggle("hidden", !selected);
    $(tabId).classList.toggle("active", selected);
    $(tabId).setAttribute("aria-selected", String(selected));
  }
}
$("activitiesTab").addEventListener("click", () => setPanelTab("activities"));
$("shopTab").addEventListener("click", () => setPanelTab("shop"));
$("characterTab").addEventListener("click", () => setPanelTab("character"));
$("panelToggle").addEventListener("click", () => {
  const collapsed = $("taskCard").classList.toggle("collapsed");
  $("panelToggle").textContent = collapsed ? "☰ Mostrar" : "Esconder";
  $("panelToggle").setAttribute("aria-expanded", String(!collapsed));
});
function updateAppearance(characterType, outfit) {
  selectedCharacterType = characterType || selectedCharacterType;
  selectedOutfit = outfit || selectedOutfit;
  socket.emit("update-appearance", {
    characterType: selectedCharacterType,
    outfit: selectedOutfit
  }, result => {
    if (!result?.ok) return showToast(result?.error || "Não foi possível mudar o visual.");
    $("appearanceMessage").textContent = "Visual atualizado! A outra pessoa já consegue ver.";
  });
}
document.querySelectorAll(".appearance-choice").forEach(button => {
  button.addEventListener("click", () => updateAppearance(button.dataset.character, null));
});
document.querySelectorAll(".outfit-choice").forEach(button => {
  button.addEventListener("click", () => updateAppearance(null, button.dataset.outfit));
});
document.querySelectorAll(".shop-item[data-item]").forEach(button => {
  button.addEventListener("click", () => {
    pendingPlacement = button.dataset.item;
    $("cancelPlacementBtn").classList.remove("hidden");
    $("shopMessage").textContent = "Toque em um espaço livre do quintal para colocar o item.";
    showToast("Agora toque no chão para escolher onde colocar.");
  });
});
$("cancelPlacementBtn").addEventListener("click", () => {
  pendingPlacement = null;
  $("cancelPlacementBtn").classList.add("hidden");
  $("shopMessage").textContent = "Os itens ficam visíveis para os dois jogadores.";
});
$("upgradeHouseBtn").addEventListener("click", () => {
  socket.emit("upgrade-house", result => {
    if (!result?.ok) return showToast(result?.error || "Não foi possível ampliar a casa.");
    $("shopMessage").textContent = `A casa ganhou uma nova ala! (${result.houseLevel}/3)`;
    showToast("Que lindo! A casa de vocês cresceu 🏡");
  });
});
socket.on("room-state", state => {
  if (!state || state.code !== roomCode) return;
  if (!scene) { pendingRoomState = state; return; }
  renderRoomState(state);
});
socket.on("player-moved", p => {
  if (p.id === myId) return;
  targetPositions.set(p.id, { x: p.x, z: p.z });
});
socket.on("player-left", () => showToast("A outra pessoa saiu da sala. Você pode continuar por aqui."));
socket.on("connect", () => {
  const params = new URLSearchParams(location.search);
  const code = params.get("room");
  if (code) {
    $("roomCode").value = code.toUpperCase();
    setMessage("Link de convite detectado. Digite seu nome e toque em Entrar.");
  }
});
socket.on("disconnect", () => showToast("Conexão perdida. Tentando reconectar..."));
socket.on("connect_error", () => {
  setMessage("Servidor multiplayer indisponível. Configure a URL do servidor em public/config.js.");
});

function renderPlayers(players) {
  const list = $("playerList");
  list.replaceChildren();
  let mine;
  for (const p of players) {
    const chip = document.createElement("div"); chip.className = "player-chip";
    const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = outfitColors[p.outfit] || p.color;
    const character = document.createElement("span");
    character.textContent = p.characterType === "female" ? "👩" : "👨";
    const label = document.createElement("span"); label.textContent = `${p.name}${p.id === myId ? " (você)" : ""}`;
    chip.append(dot, character, label); list.append(chip);
    if (p.id === myId) mine = p;
    if (p.id !== myId) {
      if (!avatars.has(p.id)) {
        const avatar = createAvatar(p.color, p.name, p.characterType, p.outfit);
        scene.add(avatar); avatars.set(p.id, avatar);
      }
      let avatar = avatars.get(p.id);
      if (avatar.userData.characterType !== p.characterType || avatar.userData.outfit !== p.outfit) {
        const replacement = createAvatar(p.color, p.name, p.characterType, p.outfit);
        replacement.position.copy(avatar.position);
        replacement.rotation.copy(avatar.rotation);
        scene.remove(avatar);
        disposeObject(avatar);
        scene.add(replacement);
        avatars.set(p.id, replacement);
        avatar = replacement;
      }
      avatar.userData.name = p.name;
      targetPositions.set(p.id, { x: p.x, z: p.z });
    }
  }
  for (const [id, avatar] of avatars) {
    if (!players.some(p => p.id === id)) { scene.remove(avatar); disposeObject(avatar); avatars.delete(id); targetPositions.delete(id); }
  }
  if (mine) {
    money = mine.money; taskCount = mine.taskCount;
    $("money").textContent = money; $("tasks").textContent = taskCount;
    if (!localAvatar) {
      localAvatar = createAvatar(mine.color, mine.name, mine.characterType, mine.outfit);
      scene.add(localAvatar);
    } else if (localAvatar.userData.characterType !== mine.characterType || localAvatar.userData.outfit !== mine.outfit) {
      const replacement = createAvatar(mine.color, mine.name, mine.characterType, mine.outfit);
      replacement.position.copy(localAvatar.position);
      replacement.rotation.copy(localAvatar.rotation);
      scene.remove(localAvatar);
      disposeObject(localAvatar);
      scene.add(replacement);
      localAvatar = replacement;
    }
    selectedCharacterType = mine.characterType || "male";
    selectedOutfit = mine.outfit || "lavender";
    renderAppearanceSelection();
    localAvatar.position.x = mine.x; localAvatar.position.z = mine.z;
  }
}
function renderAppearanceSelection() {
  document.querySelectorAll(".appearance-choice").forEach(button => {
    const selected = button.dataset.character === selectedCharacterType;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll(".outfit-choice").forEach(button => {
    const selected = button.dataset.outfit === selectedOutfit;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}
function renderRoomState(state) {
  renderPlayers(state.players);
  renderPlacedItems(state.items || []);
  applyHouseLevel(state.houseLevel || 0);
  $("upgradeHouseBtn").disabled = (state.houseLevel || 0) >= 3;
  $("houseUpgradeCost").textContent = state.houseLevel >= 3 ? "Completa" : "180 🪙";
  $("houseUpgradeLabel").textContent = state.houseLevel >= 3
    ? "O lar dos sonhos!"
    : `Nova ala (${state.houseLevel || 0}/3)`;
}
function disposeObject(obj) {
  obj.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(m => m.dispose());
    }
  });
}

function createPlacedItem(item) {
  const group = new THREE.Group();
  group.position.set(item.x, 0, item.z);
  group.rotation.y = item.rotation || 0;

  if (item.type === "tree") {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.2, .3, 1.7, 8), mat("#8d6246"));
    trunk.position.y = .85; trunk.castShadow = true; group.add(trunk);
    for (const [x, y, scale, color] of [[0, 2, 1, "#438b5a"], [-.42, 1.75, .7, "#5a9b63"], [.42, 1.75, .7, "#5a9b63"]]) {
      const leaves = new THREE.Mesh(new THREE.SphereGeometry(scale, 10, 8), mat(color));
      leaves.position.set(x, y, 0); leaves.castShadow = true; group.add(leaves);
    }
  } else if (item.type === "flower") {
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(.62, .7, .16, 10), mat("#76523a"));
    soil.position.y = .08; group.add(soil);
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5;
      const x = Math.cos(angle) * .38, z = Math.sin(angle) * .3;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(.025, .035, .42, 6), mat("#398b51"));
      stem.position.set(x, .35, z); group.add(stem);
      const flower = new THREE.Mesh(new THREE.SphereGeometry(.15, 8, 6), mat(["#f472b6", "#facc15", "#c4b5fd", "#fb7185", "#fda4af"][i]));
      flower.position.set(x, .62, z); group.add(flower);
    }
  } else if (item.type === "bench") {
    box(group, 1.7, .16, .55, "#b77b50", 0, .55, 0);
    box(group, 1.7, .72, .14, "#cc9162", 0, .95, -.2);
    for (const x of [-.65, .65]) {
      box(group, .12, .55, .12, "#805438", x, .28, -.16);
      box(group, .12, .55, .12, "#805438", x, .28, .16);
    }
  }
  return group;
}
function renderPlacedItems(items) {
  const currentIds = new Set(items.map(item => item.id));
  for (const [id, object] of placedItems) {
    if (!currentIds.has(id)) {
      scene.remove(object);
      disposeObject(object);
      placedItems.delete(id);
    }
  }
  for (const item of items) {
    if (placedItems.has(item.id)) continue;
    const object = createPlacedItem(item);
    scene.add(object);
    placedItems.set(item.id, object);
  }
}
function applyHouseLevel(level) {
  if (!houseGroup || renderedHouseLevel === level) return;
  houseGroup.children
    .filter(child => child.userData.houseUpgrade)
    .forEach(child => {
      houseGroup.remove(child);
      disposeObject(child);
    });
  for (let i = 0; i < Math.min(level, 3); i++) {
    const section = new THREE.Group();
    section.userData.houseUpgrade = true;
    const x = i === 0 ? -5.15 : i === 1 ? 5.15 : 0;
    const z = i === 2 ? -4.05 : 0;
    const width = i === 2 ? 6.5 : 3.1;
    const depth = i === 2 ? 3.2 : 4.2;
    box(section, width, 2.9, depth, "#fff0d8", x, 1.45, z);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(i === 2 ? 5 : 2.8, 1.35, 4), mat("#b86e78"));
    roof.position.set(x, 3.55, z);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1, 1, .72);
    roof.castShadow = true;
    section.add(roof);
    box(section, .9, 1.6, .12, "#91d8e5", x, 1.65, z + depth / 2 + .07);
    houseGroup.add(section);
  }
  renderedHouseLevel = level;
}

function init3D() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color("#a9d7d0");
  scene.fog = new THREE.Fog("#a9d7d0", 18, 42);
  camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 8, 12);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $("scene").appendChild(renderer.domElement);
  clock = new THREE.Clock();

  const hemi = new THREE.HemisphereLight("#f1f8ff", "#6d8060", 2.1); scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff1d4", 2.4);
  sun.position.set(-5, 12, 7); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
  scene.add(sun);
  createWorld();
  setupControls();
  if (pendingRoomState) { renderRoomState(pendingRoomState); pendingRoomState = null; }
  window.addEventListener("resize", resize);
  animate();
}
function mat(color, roughness = 0.85) { return new THREE.MeshStandardMaterial({ color, roughness }); }
function box(parent, w, h, d, color, x, y, z, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  if (opts.rotationY) mesh.rotation.y = opts.rotationY;
  parent.add(mesh); return mesh;
}
function createWorld() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), mat("#82bd8a"));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.06; ground.receiveShadow = true; scene.add(ground);
  // Yard path and stepping stones.
  box(scene, 3.2, .06, 12, "#d9c39b", 0, .01, 5);
  for (let i = 0; i < 5; i++) {
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(.38, .42, .08, 8), mat("#e7d8bb"));
    stone.position.set((i % 2) * .7 - .35, .06, 1 + i * 1.4); stone.receiveShadow = true; scene.add(stone);
  }
  houseGroup = new THREE.Group(); scene.add(houseGroup);
  // House body, roof, doorway and windows.
  box(houseGroup, 8, 3.5, 6, "#fff0d8", 0, 1.75, 0);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(6.3, 2.6, 4), mat("#b86e78"));
  roof.position.set(0, 4.8, 0); roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, .72); roof.castShadow = true; houseGroup.add(roof);
  box(houseGroup, 1.15, 2.1, .16, "#8e5e49", 0, 1.05, 3.06);
  box(houseGroup, 1.35, 1.05, .12, "#91d8e5", -2.2, 2.15, 3.08);
  box(houseGroup, 1.35, 1.05, .12, "#91d8e5", 2.2, 2.15, 3.08);
  box(houseGroup, .08, 1.1, .16, "#fff0d8", -2.2, 2.15, 3.16);
  box(houseGroup, .08, 1.1, .16, "#fff0d8", 2.2, 2.15, 3.16);
  // Visible cozy interior furniture, arranged partly in front of the house.
  box(houseGroup, 2.1, .5, 1.0, "#a76d9b", -2.3, .45, -1.2);
  box(houseGroup, 2.1, .55, .22, "#c88eb7", -2.3, .8, -1.65);
  box(houseGroup, 1.0, .16, 1.0, "#d4a66b", 1.8, .55, -1.2);
  box(houseGroup, .12, .55, .12, "#8e6949", 1.45, .27, -1.55);
  box(houseGroup, .12, .55, .12, "#8e6949", 2.15, .27, -1.55);
  // Garden beds and flowers.
  box(scene, 2.4, .25, 1.4, "#76523a", -5.2, .12, 1.0);
  for (let i = 0; i < 8; i++) {
    const x = -6.1 + (i % 4) * .6, z = .6 + Math.floor(i / 4) * .65;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(.035, .045, .45, 6), mat("#398b51"));
    stem.position.set(x, .43, z); scene.add(stem);
    const flower = new THREE.Mesh(new THREE.SphereGeometry(.16, 8, 6), mat(["#f472b6","#facc15","#c4b5fd","#fb7185"][i % 4]));
    flower.position.set(x, .69, z); scene.add(flower);
  }
  // Trees and shrubs.
  for (const [x,z,s] of [[-8,-3,1.1],[7,-4,1.2],[-8,6,.9],[8,5,1]]) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.18*s,.25*s,1.5*s,7),mat("#8d6246"));
    trunk.position.set(x,.75*s,z); trunk.castShadow=true; scene.add(trunk);
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.05*s,10,8),mat("#438b5a"));
    leaves.position.set(x,1.8*s,z); leaves.castShadow=true; scene.add(leaves);
  }
  // Fence.
  for (let i=0;i<12;i++) {
    const x=-6.2+i*1.12;
    box(scene,.12,.7,.12,"#f3e5c9",x,.35,7.1);
  }
  box(scene,13,.12,.12,"#f3e5c9",0,.65,7.1);
  // Floating home marker.
  const sign = new THREE.Mesh(new THREE.SphereGeometry(.25,12,8),mat("#f472b6"));
  sign.position.set(0,5.9,3.5); scene.add(sign);
}
function createAvatar(color, name, characterType = "male", outfit = "lavender") {
  const group = new THREE.Group();
  group.userData.name = name;
  group.userData.characterType = characterType;
  group.userData.outfit = outfit;
  group.userData.walking = false;
  const skin = mat("#f2c7a5"), clothes = mat(outfitColors[outfit] || color);
  const pants = mat("#4b5563"), hair = mat("#4a3044");
  const shoes = mat("#f7f0e7"), eyeMaterial = mat("#352b36");

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.3, .52, 5, 10), clothes);
  torso.position.y = 1.05;
  torso.castShadow = true;
  group.add(torso);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(.12, .035, 6, 12), mat("#fff0d8"));
  collar.position.set(0, 1.37, .015);
  collar.rotation.x = Math.PI / 2;
  group.add(collar);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(.2, .22, .09, 10), mat("#73513f"));
  belt.position.y = .68;
  group.add(belt);

  const head = new THREE.Mesh(new THREE.SphereGeometry(.31, 16, 12), skin);
  head.position.y = 1.68;
  head.castShadow = true;
  group.add(head);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(characterType === "female" ? .34 : .31, 14, 10, 0, Math.PI * 2, 0, Math.PI * .55), hair);
  hairCap.position.set(0, 1.78, -.025);
  group.add(hairCap);
  if (characterType === "female") {
    for (const side of [-1, 1]) {
      const lock = new THREE.Mesh(new THREE.CapsuleGeometry(.11, .34, 3, 7), hair);
      lock.position.set(side * .25, 1.48, -.015);
      lock.castShadow = true;
      group.add(lock);
    }
    const ponytail = new THREE.Mesh(new THREE.SphereGeometry(.19, 10, 8), hair);
    ponytail.position.set(0, 1.48, -.28);
    ponytail.castShadow = true;
    group.add(ponytail);
  }

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 6), eyeMaterial);
    eye.position.set(side * .105, 1.69, .278);
    group.add(eye);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(.045, 8, 6), skin);
  nose.position.set(0, 1.59, .31);
  group.add(nose);
  const smileCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-.07, 1.53, .295),
    new THREE.Vector3(0, 1.49, .32),
    new THREE.Vector3(.07, 1.53, .295)
  );
  const smile = new THREE.Mesh(new THREE.TubeGeometry(smileCurve, 8, .012, 5, false), eyeMaterial);
  group.add(smile);

  for (const side of [-1, 1]) {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * .37, 1.3, 0);
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(.105, .25, 4, 7), clothes);
    sleeve.position.y = -.18;
    sleeve.rotation.z = -side * .12;
    sleeve.castShadow = true;
    armPivot.add(sleeve);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), skin);
    hand.position.set(-side * .025, -.39, .015);
    armPivot.add(hand);
    group.add(armPivot);
    group.userData[side < 0 ? "leftArm" : "rightArm"] = armPivot;

    const legPivot = new THREE.Group();
    legPivot.position.set(side * .15, .66, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(.115, .36, 4, 7), pants);
    leg.position.y = -.28;
    leg.castShadow = true;
    legPivot.add(leg);
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(.14, 10, 7), shoes);
    shoe.scale.set(.9, .55, 1.35);
    shoe.position.set(0, -.54, .055);
    shoe.castShadow = true;
    legPivot.add(shoe);
    group.add(legPivot);
    group.userData[side < 0 ? "leftLeg" : "rightLeg"] = legPivot;
  }

  const badge = new THREE.Mesh(new THREE.SphereGeometry(.085, 9, 7), mat("#f9a8d4"));
  badge.position.set(.14, 1.12, .27);
  group.add(badge);
  return group;
}
function animateAvatar(avatar, isMoving, elapsed) {
  const stride = isMoving ? Math.sin(elapsed * 11) : 0;
  avatar.userData.leftArm.rotation.x = stride * .55;
  avatar.userData.rightArm.rotation.x = -stride * .55;
  avatar.userData.leftLeg.rotation.x = -stride * .48;
  avatar.userData.rightLeg.rotation.x = stride * .48;
  avatar.position.y = isMoving ? Math.abs(Math.sin(elapsed * 11)) * .045 : 0;
  avatar.userData.walking = isMoving;
}
function setupControls() {
  const joy = $("joystick"), stick = $("stick");
  let activePointer = null, center = {x:0,y:0};
  const maxRadius = 29;
  joy.addEventListener("pointerdown", e => {
    activePointer = e.pointerId; joy.setPointerCapture(activePointer);
    const r = joy.getBoundingClientRect(); center = {x:r.left+r.width/2,y:r.top+r.height/2};
    updateStick(e);
  });
  joy.addEventListener("pointermove", e => { if (e.pointerId === activePointer) updateStick(e); });
  function endJoy(e) {
    if (e.pointerId !== activePointer) return;
    activePointer = null; moveVector = {x:0,z:0}; stick.style.transform = "translate(0,0)";
  }
  joy.addEventListener("pointerup", endJoy); joy.addEventListener("pointercancel", endJoy);
  function updateStick(e) {
    let dx=e.clientX-center.x, dy=e.clientY-center.y;
    const len=Math.hypot(dx,dy); if(len>maxRadius){dx=dx/len*maxRadius;dy=dy/len*maxRadius;}
    stick.style.transform=`translate(${dx}px,${dy}px)`;
    moveVector={x:dx/maxRadius,z:dy/maxRadius};
  }
  const canvas = renderer.domElement;
  let cameraPointerStart = null;
  canvas.addEventListener("pointerdown", e => {
    if (e.target === canvas) {
      draggingCamera = true;
      lastPointerX = e.clientX;
      cameraPointerStart = { x: e.clientX, y: e.clientY };
    }
  });
  canvas.addEventListener("click", e => {
    if (!pendingPlacement || !cameraPointerStart) return;
    const moved = Math.hypot(e.clientX - cameraPointerStart.x, e.clientY - cameraPointerStart.y);
    cameraPointerStart = null;
    if (moved > 10) return;
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const position = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(ground, position)) return;
    socket.emit("place-item", {
      itemType: pendingPlacement,
      x: Number(position.x.toFixed(2)),
      z: Number(position.z.toFixed(2)),
      rotation: 0
    }, result => {
      if (!result?.ok) return showToast(result?.error || "Não foi possível colocar esse item.");
      pendingPlacement = null;
      $("cancelPlacementBtn").classList.add("hidden");
      $("shopMessage").textContent = "Os itens ficam visíveis para os dois jogadores.";
      showToast("Decoração colocada no quintal 🌿");
    });
  });
  window.addEventListener("pointermove", e => {
    if (!draggingCamera) return;
    cameraAngle += (e.clientX-lastPointerX)*.006; lastPointerX=e.clientX;
  });
  window.addEventListener("pointerup", () => draggingCamera=false);
  window.addEventListener("keydown", e => {
    if(["ArrowUp","w","W"].includes(e.key)) moveVector.z=-1;
    if(["ArrowDown","s","S"].includes(e.key)) moveVector.z=1;
    if(["ArrowLeft","a","A"].includes(e.key)) moveVector.x=-1;
    if(["ArrowRight","d","D"].includes(e.key)) moveVector.x=1;
  });
  window.addEventListener("keyup", e => {
    if(["ArrowUp","ArrowDown","w","W","s","S"].includes(e.key)) moveVector.z=0;
    if(["ArrowLeft","ArrowRight","a","A","d","D"].includes(e.key)) moveVector.x=0;
  });
}
let lastSend = 0;
function sendPosition() {
  if (localAvatar && roomCode) socket.emit("move", {x:localAvatar.position.x,z:localAvatar.position.z});
}
function animate() {
  requestAnimationFrame(animate);
  if (!renderer || !scene) return;
  const dt = Math.min(clock.getDelta(), .04);
  if (localAvatar) {
    const speed = 3.3 * dt;
    const forward = -moveVector.z, side = moveVector.x;
    const dx = (side*Math.cos(cameraAngle) + forward*Math.sin(cameraAngle))*speed;
    const dz = (forward*Math.cos(cameraAngle) - side*Math.sin(cameraAngle))*speed;
    const isMoving = Math.abs(dx) + Math.abs(dz) > .0001;
    if (isMoving) {
      localAvatar.position.x = THREE.MathUtils.clamp(localAvatar.position.x+dx,-12,12);
      localAvatar.position.z = THREE.MathUtils.clamp(localAvatar.position.z+dz,-12,12);
      localAvatar.rotation.y = Math.atan2(dx,dz);
      if (performance.now()-lastSend>60) { sendPosition(); lastSend=performance.now(); }
    }
    animateAvatar(localAvatar, isMoving, clock.elapsedTime);
  }
  for (const [id, avatar] of avatars) {
    const target=targetPositions.get(id); if(!target) continue;
    const previousX = avatar.position.x, previousZ = avatar.position.z;
    avatar.position.x += (target.x-avatar.position.x)*Math.min(1,dt*12);
    avatar.position.z += (target.z-avatar.position.z)*Math.min(1,dt*12);
    const dx = avatar.position.x - previousX, dz = avatar.position.z - previousZ;
    const isMoving = Math.abs(dx) + Math.abs(dz) > .001;
    if (isMoving) avatar.rotation.y = Math.atan2(dx, dz);
    animateAvatar(avatar, isMoving, clock.elapsedTime);
  }
  const focus = localAvatar ? localAvatar.position : new THREE.Vector3(0,0,0);
  const distance = 10.5;
  const desired = new THREE.Vector3(
    focus.x + Math.sin(cameraAngle)*distance,
    focus.y + 7.0,
    focus.z + Math.cos(cameraAngle)*distance
  );
  camera.position.lerp(desired, Math.min(1,dt*3));
  camera.lookAt(focus.x, .7, focus.z);
  renderer.render(scene,camera);
}
function resize() {
  if (!renderer || !camera) return;
  camera.aspect=window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth,window.innerHeight);
}
const params = new URLSearchParams(location.search);
if (params.get("room")) $("roomCode").value = params.get("room").toUpperCase();
