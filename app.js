const STORAGE_KEY = "cis-linha6-eventos";
const PUBLIC_STATIC_MODE = true;
const TEXT_STORAGE_KEY = "cis-linha6-textos";
const PASSWORD_STORAGE_KEY = "cis-linha6-senha-textos";
const DASHBOARD_PASSWORD_STORAGE_KEY = "cis-linha6-senha-impacto";
const ADMIN_SESSION_STORAGE_KEY = "cis-linha6-admin-session-expiry";
const FIELD_REPORT_STORAGE_KEY = "cis-linha6-relatorios-campo";
const DATA_VERSION_STORAGE_KEY = "cis-linha6-data-version";
const DEFAULT_TEXT_PASSWORD = "CIS2026";
const DEFAULT_DASHBOARD_PASSWORD = "IMPACTO2026";
const ADMIN_SESSION_DURATION = 10 * 60 * 1000;
const MIN_EVENT_DATE = "2026-07-01";
const baseEvents = window.CIS_EVENTS_DATA?.events || [];
const DATA_VERSION = window.CIS_EVENTS_DATA?.importedAt || "2026-07-21-capas";
let events = loadEvents();
let fieldReports = loadFieldReports();
let textEditEnabled = false;
let passwordMode = "unlock";
let eventVolumeMode = "date";
let editingEventId = null;
let pendingEventImage = "";
let eventImageProcessing = null;
let eventImageSelectionToken = 0;
let pendingFieldReport = null;
let backendSyncReady = false;
let backendSaveTimer = null;
const impactWeight = { ALTO: 3, MÉDIO: 2, MEDIO: 2, BAIXO: 1, "MÃ‰DIO": 2 };
const numberFormatter = new Intl.NumberFormat("pt-BR");
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const monthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const weekdayFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const lineStations = [{ code: "PMG", name: "Pátio Morro Grande" }, { code: "BRA", name: "Brasilândia" }, { code: "MTL", name: "Maristela" }, { code: "IHP", name: "Itaberaba-Hospital Vila Penteado" }, { code: "JOP", name: "João Paulo I" }, { code: "FGO", name: "Freguesia do Ó" }, { code: "SMA", name: "Santa Marina" }, { code: "AGB", name: "Água Branca" }, { code: "SEP", name: "SESC-Pompeia" }, { code: "PDZ", name: "Perdizes" }, { code: "PUC", name: "PUC-Cardoso de Almeida" }, { code: "FAP", name: "FAAP-Pacaembu" }, { code: "HMK", name: "Higienópolis-Mackenzie" }, { code: "BIS", name: "14 Bis-Saracura" }, { code: "BVT", name: "Bela Vista" }, { code: "SJO", name: "São Joaquim" }];
const stationCodeAlias = { HIG: "HMK" };
const dashboardHours = ["06h", "08h", "10h", "12h", "14h", "16h", "18h", "20h", "22h"];
const typeLabels = [{ key: "SHOW", label: "Shows" }, { key: "JOGO", label: "Jogos" }, { key: "FUTEBOL", label: "Jogos" }, { key: "CORRIDA", label: "Corridas" }, { key: "MANIFESTACAO", label: "Manifestações" }, { key: "MANIFESTAÇÃO", label: "Manifestações" }, { key: "UNIVERSITARIO", label: "Universitários" }, { key: "UNIVERSITÁRIO", label: "Universitários" }];
function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}
function normalizeStationCode(value) {
  const code = normalizeText(value);
  return stationCodeAlias[code] || code;
}
function displayImpact(value) {
  const normalized = normalizeText(value);
  if (normalized === "MEDIO" || normalized === "MÃ‰DIO") return "MÉDIO";
  return normalized || "-";
}
function displayYesNo(value) {
  return normalizeText(value) === "SIM" ? "SIM" : "NÃO";
}
function getTextPassword() {
  return localStorage.getItem(PASSWORD_STORAGE_KEY) || DEFAULT_TEXT_PASSWORD;
}
function getDashboardPassword() {
  return localStorage.getItem(DASHBOARD_PASSWORD_STORAGE_KEY) || DEFAULT_DASHBOARD_PASSWORD;
}
function grantAdminSession() {
  sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, String(Date.now() + ADMIN_SESSION_DURATION));
}
function hasActiveAdminSession() {
  const expiresAt = Number(sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) || 0);
  if (expiresAt > Date.now()) return true;
  sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  return false;
}
function requestAdminAccess() {
  if (PUBLIC_STATIC_MODE) return;
  if (hasActiveAdminSession()) {
    openDrawer("#adminDrawer");
    return;
  }
  openPasswordModal("admin");
}
function requestFieldReportAccess() {
  if (PUBLIC_STATIC_MODE) return;
  const reportButton = document.querySelector("#navFieldReport");
  if (hasActiveAdminSession()) {
    showView("fieldReportView", reportButton);
    return;
  }
  openPasswordModal("field-report");
}
function impactClass(value) {
  const impact = displayImpact(value);
  if (impact === "ALTO") return "impact-high";
  if (impact === "MÉDIO") return "impact-medium";
  if (impact === "BAIXO") return "impact-low";
  return "";
}
function loadTextOverrides() {
  if (PUBLIC_STATIC_MODE) return {};
  try {
    const saved = JSON.parse(localStorage.getItem(TEXT_STORAGE_KEY) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}
function saveTextOverride(id, value) {
  const overrides = loadTextOverrides();
  overrides[id] = value;
  localStorage.setItem(TEXT_STORAGE_KEY, JSON.stringify(overrides));
  scheduleBackendSave();
}
function scheduleBackendSave() {
  if (PUBLIC_STATIC_MODE) return;
  if (!backendSyncReady) return;
  window.clearTimeout(backendSaveTimer);
  backendSaveTimer = window.setTimeout(persistBackendState, 250);
}
async function persistBackendState() {
  try {
    const response = await fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events, texts: loadTextOverrides(), fieldReports, updatedAt: new Date().toISOString() }) });
    if (!response.ok) throw new Error("Falha ao salvar no servidor");
  } catch {
    window.alert("As alterações foram salvas neste navegador, mas não foi possível gravá-las no backend.");
  }
}
async function syncFromBackend() {
  if (PUBLIC_STATIC_MODE) return;
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("Backend indisponível");
    const state = await response.json();
    if (Array.isArray(state.events)) events = state.events.filter(isEventInScope);
    if (Array.isArray(state.fieldReports)) fieldReports = state.fieldReports;
    if (state.texts && typeof state.texts === "object") localStorage.setItem(TEXT_STORAGE_KEY, JSON.stringify(state.texts));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    localStorage.setItem(DATA_VERSION_STORAGE_KEY, DATA_VERSION);
    localStorage.setItem(FIELD_REPORT_STORAGE_KEY, JSON.stringify(fieldReports));
    backendSyncReady = true;
    applyTextOverrides();
    render();
  } catch {
    backendSyncReady = false;
  }
}
function exportSiteBackup() {
  const payload = { version: 1, exportedAt: new Date().toISOString(), events, texts: loadTextOverrides(), fieldReports };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `linha6-eventos-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function applyTextOverrides() {
  const overrides = loadTextOverrides();
  document.querySelectorAll("[data-edit-id]").forEach((element) => {
    const value = overrides[element.dataset.editId];
    if (value !== undefined) element.textContent = value;
  });
}
function saveEvents() {
  events = events.filter(isEventInScope);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    localStorage.setItem(DATA_VERSION_STORAGE_KEY, DATA_VERSION);
    scheduleBackendSave();
    return true;
  } catch (error) {
    console.error("Não foi possível salvar os eventos.", error);
    return false;
  }
}
function loadEvents() {
  if (PUBLIC_STATIC_MODE) return structuredClone(baseEvents).filter(isEventInScope);
  const saved = localStorage.getItem(STORAGE_KEY);
  const savedVersion = localStorage.getItem(DATA_VERSION_STORAGE_KEY);
  if (!saved || savedVersion !== DATA_VERSION) return structuredClone(baseEvents).filter(isEventInScope);
  try {
    const parsed = JSON.parse(saved);
    return (Array.isArray(parsed) ? parsed : structuredClone(baseEvents)).filter(isEventInScope);
  } catch {
    return structuredClone(baseEvents).filter(isEventInScope);
  }
}
function loadFieldReports() {
  try {
    const saved = JSON.parse(localStorage.getItem(FIELD_REPORT_STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}
function saveFieldReports() {
  try {
    localStorage.setItem(FIELD_REPORT_STORAGE_KEY, JSON.stringify(fieldReports));
    scheduleBackendSave();
    return true;
  } catch {
    return false;
  }
}
function isEventInScope(event) {
  const eventDate = parseDate(event?.data);
  const minDate = parseDate(MIN_EVENT_DATE);
  const stations = (event?.estacoes || []).map((station) => normalizeText(station));
  return !!eventDate && !!minDate && eventDate >= minDate && !stations.includes("X");
}
function parseDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
function formatDate(value) {
  const date = parseDate(value);
  return date ? dateFormatter.format(date) : value || "-";
}
function dayNumber(value) {
  const date = parseDate(value);
  return date ? String(date.getDate()).padStart(2, "0") : "--";
}
function weekday(value, fallback) {
  const date = parseDate(value);
  return normalizeText(fallback || (date ? weekdayFormatter.format(date) : "")).replace(".", "");
}
function syncEventWeekday() {
  const dateInput = document.querySelector("#eventDate");
  const weekdayInput = document.querySelector("#eventWeekday");
  if (!dateInput || !weekdayInput) return;
  weekdayInput.value = dateInput.value ? weekday(dateInput.value) : "";
}
function monthKey(value) {
  const date = parseDate(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : "sem-data";
}
function monthLabel(value) {
  const date = parseDate(value);
  return date ? monthFormatter.format(date).toUpperCase() : "SEM DATA";
}
function formatAudience(value) {
  const audience = Number(value);
  return numberFormatter.format(Number.isFinite(audience) ? audience : 0);
}
function isAudienceUndisclosed(event) {
  const audience = Number(event?.publico);
  return event?.publicoNaoDivulgado === true || normalizeText(event?.publico).includes("NAO DIVULGADO") || (Number.isFinite(audience) && audience === 0);
}
function formatEventAudience(event) {
  return isAudienceUndisclosed(event) ? "Não divulgado" : `${formatAudience(event?.publico)} pessoas`;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}
function renderFieldReportOptions() {
  const select = document.querySelector("#fieldReportEvent");
  if (!select) return;
  const selected = select.value;
  const source = events.filter(isEventInScope).sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));
  select.innerHTML = `<option value="">Selecione um evento</option>${source.map((event) => `<option value="${event.id}">${formatDate(event.data)} | ${escapeHtml(event.evento || "Evento sem nome")}</option>`).join("")}`;
  if (source.some((event) => String(event.id) === selected)) select.value = selected;
}
function updateFieldEventSummary(event) {
  const target = document.querySelector("#fieldEventSummary");
  if (!event) {
    target.textContent = "Selecione um evento para carregar data, local e estações.";
    return;
  }
  target.innerHTML = `<span><strong>Data</strong>${formatDate(event.data)}</span><span><strong>Local</strong>${escapeHtml(event.local || "Não informado")}</span><span><strong>Estações previstas</strong>${escapeHtml((event.estacoes || []).join(", ") || "Não informadas")}</span>`;
}
function loadFieldReportForSelectedEvent() {
  const form = document.querySelector("#fieldReportForm");
  const selectedId = form.elements.eventoId.value;
  const event = events.find((item) => String(item.id) === String(selectedId));
  const saved = fieldReports.find((item) => String(item.eventoId) === String(selectedId));
  const preservedId = selectedId;
  form.reset();
  form.elements.eventoId.value = preservedId;
  updateFieldEventSummary(event);
  if (!event) {
    document.querySelector("#fieldReportStatus").textContent = "Novo relatório";
    return;
  }
  form.elements.estacoesImpactadas.value = (event.estacoes || []).join(", ");
  if (!saved) {
    document.querySelector("#fieldReportStatus").textContent = "Novo relatório";
    return;
  }
  ["supervisor", "inicioOperacao", "terminoOperacao", "apoioOperacional", "equipeTatica", "houveImpacto", "nivelImpacto", "tipoImpacto", "estacoesImpactadas", "descricao"].forEach((field) => {
    form.elements[field].value = saved[field] ?? "";
  });
  document.querySelector("#fieldReportStatus").textContent = "Relatório salvo";
}
function captureFieldReport() {
  const form = document.querySelector("#fieldReportForm");
  if (!form.reportValidity()) return null;
  const data = new FormData(form);
  const event = events.find((item) => String(item.id) === String(data.get("eventoId")));
  if (!event) return null;
  const savedReport = fieldReports.find((item) => String(item.eventoId) === String(event.id));
  return { id: savedReport?.id || Date.now(), eventoId: event.id, evento: event.evento || "Evento sem nome", dataEvento: event.data, local: event.local || "Não informado", estacoesPrevistas: (event.estacoes || []).join(", "), supervisor: String(data.get("supervisor") || "").trim(), emailDestinatario: savedReport?.emailDestinatario || "", inicioOperacao: String(data.get("inicioOperacao") || ""), terminoOperacao: String(data.get("terminoOperacao") || ""), apoioOperacional: Number(data.get("apoioOperacional") || 0), equipeTatica: String(data.get("equipeTatica") || ""), houveImpacto: String(data.get("houveImpacto") || ""), nivelImpacto: String(data.get("nivelImpacto") || ""), tipoImpacto: String(data.get("tipoImpacto") || ""), estacoesImpactadas: String(data.get("estacoesImpactadas") || "").trim(), descricao: String(data.get("descricao") || "").trim(), atualizadoEm: new Date().toISOString() };
}
function isAllowedReportEmail(value) {
  return /^[^@\s]+@linhauni\.com\.br$/i.test(String(value || "").trim());
}
function openReportRecipientModal(report) {
  pendingFieldReport = report;
  const modal = document.querySelector("#reportRecipientModal");
  document.querySelector("#reportRecipientEmail").value = report.emailDestinatario || "";
  document.querySelector("#reportRecipientError").textContent = "";
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.querySelector("#reportRecipientEmail").focus();
}
function closeReportRecipientModal() {
  const modal = document.querySelector("#reportRecipientModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  pendingFieldReport = null;
}
function storeFieldReport(report) {
  const existingIndex = fieldReports.findIndex((item) => String(item.eventoId) === String(report.eventoId));
  const reportsBeforeSave = [...fieldReports];
  if (existingIndex >= 0) fieldReports[existingIndex] = report;
  else fieldReports.push(report);
  if (!saveFieldReports()) {
    fieldReports = reportsBeforeSave;
    window.alert("Não foi possível salvar o relatório.");
    return false;
  }
  document.querySelector("#fieldReportStatus").textContent = "Relatório salvo";
  return true;
}
function wrapPdfText(value, limit = 82) {
  const words = String(value || "").replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";
  words.forEach((word) => {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= limit) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}
function pdfText(value) {
  return String(value ?? "").replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\xFF]/g, "?").replace(/([\\()])/g, "\\$1");
}
function getFieldReportPdfLines(report) {
  const rows = ["RELATÓRIO DE CAMPO", "Centro de Inteligência e Segurança | Linha 6-Laranja", "", `Evento: ${report.evento}`, `Data: ${formatDate(report.dataEvento)}`, `Local: ${report.local}`, `Estações previstas: ${report.estacoesPrevistas || "Não informadas"}`, "", "OPERAÇÃO EM CAMPO", `Supervisor: ${report.supervisor}`, `Início: ${report.inicioOperacao || "Não informado"}`, `Término: ${report.terminoOperacao || "Não informado"}`, `Apoio operacional: ${formatAudience(report.apoioOperacional)} colaboradores`, `Equipe tática: ${report.equipeTatica || "Não informado"}`, "", "IMPACTO CONSTATADO", `Houve impacto: ${report.houveImpacto}`, `Nível: ${report.nivelImpacto}`, `Tipo: ${report.tipoImpacto}`, `Estações impactadas: ${report.estacoesImpactadas || "Nenhuma"}`, "", "Descrição e providências:", report.descricao || "Não informado", "", `Atualizado em: ${new Date(report.atualizadoEm).toLocaleString("pt-BR")}`];
  return rows.flatMap((row) => wrapPdfText(row));
}
function createFieldReportPdf(report) {
  const lines = getFieldReportPdfLines(report);
  const pages = [];
  for (let index = 0; index < lines.length; index += 38) pages.push(lines.slice(index, index + 38));
  const fontObjectId = 3 + pages.length * 2;
  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  pages.forEach((pageLines, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    const content = `BT\n/F1 11 Tf\n50 790 Td\n${pageLines.map((line, lineIndex) => `${lineIndex ? "0 -18 Td\n" : ""}(${pdfText(line)}) Tj`).join("\n")}\nET`;
    objects[pageObjectId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    objects[contentObjectId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  objects[fontObjectId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = pdf.length;
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([Uint8Array.from(pdf, (character) => character.charCodeAt(0) & 255)], { type: "application/pdf" });
}
function fieldReportFilename(report) {
  const eventName = normalizeText(report.evento).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "evento";
  return `relatorio-de-campo-${eventName}-${report.dataEvento}.pdf`;
}
function downloadFieldReportPdf(report, blob = createFieldReportPdf(report)) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = fieldReportFilename(report);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportFieldReport(report) {
  downloadFieldReportPdf(report);
}
async function emailFieldReport(report) {
  const blob = createFieldReportPdf(report);
  const file = new File([blob], fieldReportFilename(report), { type: "application/pdf" });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    try {
      await navigator.share({ title: `Relatório de campo | ${report.evento}`, files: [file] });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  downloadFieldReportPdf(report, blob);
  window.alert("O compartilhamento direto não está disponível neste navegador. O PDF foi baixado para ser anexado ao e-mail.");
}
function getFilteredEvents() {
  const query = normalizeText(document.querySelector("#searchInput")?.value);
  const impact = normalizeText(document.querySelector("#impactFilter")?.value);
  const start = document.querySelector("#calendarStart")?.value || MIN_EVENT_DATE;
  const end = document.querySelector("#calendarEnd")?.value || "";
  return events.filter(isEventInScope).filter((event) => {
    const haystack = normalizeText([event.evento, event.local, event.impacto, event.classificacao, ...(event.estacoes || [])].join(" "));
    const sameImpact = !impact || normalizeText(event.impacto) === impact;
    const samePeriod = String(event.data || "") >= start && (!end || String(event.data || "") <= end);
    return (!query || haystack.includes(query)) && sameImpact && samePeriod;
  });
}
function getDashboardEvents() {
  const query = normalizeText(document.querySelector("#dashboardSearch")?.value);
  const queryStation = normalizeStationCode(query);
  const category = normalizeText(document.querySelector("#dashboardCategory")?.value);
  const station = normalizeStationCode(document.querySelector("#dashboardStation")?.value);
  const impact = displayImpact(document.querySelector("#dashboardImpact")?.value);
  return events.filter(isEventInScope).filter((event) => {
    const stations = (event.estacoes || []).map(normalizeStationCode);
    const stationNames = stations.map((code) => lineStations.find((item) => item.code === code)?.name || "");
    const haystack = normalizeText([event.evento, event.local, event.classificacao, displayImpact(event.impacto), ...stations, ...stationNames].join(" "));
    const sameCategory = !category || normalizeText(classifyEventType(event)) === category || normalizeText(event.classificacao) === category;
    const sameStation = !station || stations.includes(station);
    const sameImpact = !impact || impact === "-" || displayImpact(event.impacto) === impact;
    const sameQuery = !query || haystack.includes(query) || (queryStation !== query && haystack.includes(queryStation));
    return sameQuery && sameCategory && sameStation && sameImpact;
  });
}
function renderDashboardFilters(source) {
  const category = document.querySelector("#dashboardCategory");
  const station = document.querySelector("#dashboardStation");
  if (!category || !station) return;
  const currentCategory = category.value;
  const currentStation = station.value;
  const categories = [...new Set(source.map(classifyEventType))].sort();
  category.innerHTML = `<option value="">Todas as categorias</option>${categories.map((item) => `<option value="${item}">${item}</option>`).join("")}`;
  station.innerHTML = `<option value="">Todas as estações</option>${lineStations.map((item) => `<option value="${item.code}">${item.code} | ${item.name}</option>`).join("")}`;
  category.value = [...category.options].some((option) => option.value === currentCategory) ? currentCategory : "";
  station.value = [...station.options].some((option) => option.value === currentStation) ? currentStation : "";
}
function aggregateByStation(source) {
  const map = new Map();
  source.forEach((event) => {
    const stations = event.estacoes?.length ? event.estacoes : ["SEM ESTAÇÃO"];
    stations.forEach((station) => {
      const key = normalizeStationCode(station);
      const current = map.get(key) || { station: key, events: 0, audience: 0, score: 0, months: {} };
      const eventScore = (impactWeight[event.impacto] || impactWeight[displayImpact(event.impacto)] || 1) * Math.max(Number(event.publico || 0), 1);
      const eventMonth = monthLabel(event.data);
      current.events += 1;
      current.audience += Number(event.publico || 0);
      current.score += eventScore;
      current.months[eventMonth] = current.months[eventMonth] || { label: eventMonth, events: 0, audience: 0, score: 0 };
      current.months[eventMonth].events += 1;
      current.months[eventMonth].audience += Number(event.publico || 0);
      current.months[eventMonth].score += eventScore;
      map.set(key, current);
    });
  });
  return [...map.values()].sort((a, b) => b.score - a.score);
}
function aggregateByLocation(source) {
  const map = new Map();
  source.forEach((event) => {
    const stations = event.estacoes?.length ? event.estacoes : ["SEM ESTAÇÃO"];
    stations.forEach((station) => {
      const month = monthKey(event.data);
      const normalizedStation = normalizeStationCode(station);
      const key = `${month}|${normalizedStation}|${normalizeText(event.local || "SEM LOCAL")}`;
      const current = map.get(key) || { month, monthLabel: monthLabel(event.data), station: normalizedStation, location: normalizeText(event.local || "SEM LOCAL"), events: 0, audience: 0, score: 0, high: 0 };
      current.events += 1;
      current.audience += Number(event.publico || 0);
      current.score += (impactWeight[event.impacto] || impactWeight[displayImpact(event.impacto)] || 1) * Math.max(Number(event.publico || 0), 1);
      current.high += normalizeText(event.impacto) === "ALTO" ? 1 : 0;
      map.set(key, current);
    });
  });
  return [...map.values()].sort((a, b) => b.score - a.score);
}
function renderCalendar(source) {
  const target = document.querySelector("#calendarGrid");
  const sorted = [...source].sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const grouped = sorted.reduce((acc, event) => {
    const key = monthKey(event.data);
    if (!acc[key]) acc[key] = [];
    acc[key].push(event);
    return acc;
  }, {});
  target.innerHTML = Object.entries(grouped).map(([, monthEvents]) => `<section class="month-column"><div class="month-title"><span data-event-id="${monthEvents[0]?.id}" data-event-field="monthLabel">${monthLabel(monthEvents[0]?.data)}</span><span>${monthEvents.length} eventos</span></div><div class="month-events">${monthEvents.map(renderEventCard).join("")}</div></section>`).join("") || '<p class="empty-state">Nenhum evento encontrado.</p>';
  applyEditModeToDynamicText();
}
function renderEventCard(event) {
  const impact = displayImpact(event.impacto);
  const high = impact === "ALTO" ? " high" : "";
  const impactTone = impactClass(impact);
  const stations = (event.estacoes || []).join(", ") || "-";
  const category = normalizeText(event.classificacao) || "EVENTO";
  const titleClass = String(event.evento || "").length > 26 ? " event-title-long" : "";
  const eventDate = parseDate(event.data);
  const shortMonth = eventDate ? eventDate.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "").toUpperCase() : "";
  const visual = event.imagem ? `<button class="event-image-button" type="button" data-event-image="${event.id}" aria-label="Ampliar imagem de ${event.evento || "evento"}"><img src="${event.imagem}" alt="" /></button>` : `<div class="event-image-placeholder" aria-hidden="true"><img src="./assets/logo-cis.jpg" alt="" /><span>Centro de Inteligência e Segurança</span></div>`;
  return `<article class="event-card ${impactTone}${event.imagem ? " has-image" : ""}" data-event-card="${event.id}"><div class="event-visual">${visual}<span class="event-category" data-event-id="${event.id}" data-event-field="classificacao">${category}</span></div><div class="event-card-footer"><div class="date-box"><div><strong>${dayNumber(event.data)}</strong><span>${shortMonth}</span><small data-event-id="${event.id}" data-event-field="diaSemana">${weekday(event.data, event.diaSemana)}</small></div></div><div class="event-card-content"><h3 class="${titleClass.trim()}" data-event-id="${event.id}" data-event-field="evento">${event.evento || "Evento sem nome"}</h3><p class="event-location" data-event-id="${event.id}" data-event-field="local">${event.local || "Local não informado"}</p><p class="event-schedule"><span>${formatDate(event.data)}</span> | <span data-event-id="${event.id}" data-event-field="inicio">${event.inicio || "A definir"}</span> - <span data-event-id="${event.id}" data-event-field="termino">${event.termino || "A definir"}</span></p><div class="event-meta"><span class="badge ${impactTone}${high}" data-event-id="${event.id}" data-event-field="impacto">${impact}</span><span class="badge" data-event-id="${event.id}" data-event-field="estacoes">${stations}</span><span class="badge" data-event-id="${event.id}" data-event-field="publico">${formatEventAudience(event)}</span></div></div></div></article>`;
}
function updateSummary(source) {
  const highImpact = source.filter((event) => normalizeText(event.impacto) === "ALTO").length;
  const totalAudience = source.reduce((sum, event) => sum + Number(event.publico || 0), 0);
  const stationCount = aggregateByStation(source).filter((item) => item.events > 0).length;
  const peakHour = calculatePeakHour(source);
  const target = document.querySelector("#kpiGrid");
  const now = new Date();
  document.querySelector("#dashboardDate").textContent = dateFormatter.format(now);
  document.querySelector("#dashboardTime").textContent = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  document.querySelector("#dashboardEventCount").textContent = formatAudience(source.length);
  target.innerHTML = [{ value: formatAudience(source.length), label: "Eventos monitorados" }, { value: formatAudience(totalAudience), label: "Público total previsto" }, { value: formatAudience(stationCount), label: "Estações impactadas" }, { value: formatAudience(highImpact), label: "Eventos críticos", tone: highImpact ? "severity-critical" : "" }, { value: peakHour, label: "Horário de pico" }].map((item) => `<article class="kpi-card ${item.tone || ""}"><p>${item.label}</p><strong>${item.value}</strong></article>`).join("");
}
function riskLabel(value) {
  if (value >= 3) return "Alto";
  if (value >= 2) return "Médio";
  if (value >= 1) return "Baixo";
  return "Sem risco";
}
function classifyEventType(event) {
  const text = normalizeText(`${event.classificacao || ""} ${event.evento || ""}`);
  const found = typeLabels.find((item) => text.includes(normalizeText(item.key)));
  return found?.label || "Outros";
}
function countEventTypes(source) {
  return source.reduce((acc, event) => {
    const type = classifyEventType(event);
    if (type === "Shows") acc.shows += 1;
    else if (type === "Jogos") acc.jogos += 1;
    else if (type === "Manifestações") acc.manifestacoes += 1;
    else if (type === "Universitários") acc.universitarios += 1;
    else acc.outros += 1;
    return acc;
  }, { shows: 0, jogos: 0, manifestacoes: 0, universitarios: 0, outros: 0 });
}
function eventHourSlot(event) {
  const hour = Number(String(event.inicio || "").slice(0, 2));
  if (!Number.isFinite(hour)) return "18h";
  return dashboardHours.reduce((best, slot) => Math.abs(Number(slot.slice(0, 2)) - hour) < Math.abs(Number(best.slice(0, 2)) - hour) ? slot : best, dashboardHours[0]);
}
function calculatePeakHour(source) {
  const counts = dashboardHours.reduce((acc, hour) => ({ ...acc, [hour]: 0 }), {});
  source.forEach((event) => counts[eventHourSlot(event)] += 1);
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "--";
}
function renderHeatmap(source) {
  const target = document.querySelector("#stationHeatmap");
  const stations = aggregateByStation(source);
  const maxScore = Math.max(...stations.map((item) => item.score), 1);
  target.innerHTML = stations.map((item) => {
    const intensity = Math.max(0.15, item.score / maxScore);
    return `<div class="heat-cell" style="background: rgba(245, 130, 32, ${intensity.toFixed(2)})"><strong>${item.station}</strong><span>${item.events} eventos</span><span>${formatAudience(item.audience)} pessoas estimadas</span></div>`;
  }).join("") || '<p class="empty-state">Nenhuma estação encontrada.</p>';
}
function renderLocationBars(source) {
  const target = document.querySelector("#locationBars");
  const locations = aggregateByLocation(source);
  const grouped = locations.reduce((acc, item) => {
    if (!acc[item.month]) acc[item.month] = { label: item.monthLabel, items: [] };
    acc[item.month].items.push(item);
    return acc;
  }, {});
  target.innerHTML = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => {
    const items = group.items.slice(0, 5);
    const maxScore = Math.max(...items.map((item) => item.score), 1);
    return `<section class="critical-month"><h4>${group.label}</h4>${items.map((item) => `<div class="bar-row compact"><div class="bar-top"><span>${item.station} | ${item.location}</span><span>${formatAudience(item.audience)}</span></div><div class="bar-track"><div class="bar-fill" style="width: ${Math.max(8, (item.score / maxScore) * 100)}%"></div></div><small>${item.events} eventos | <span class="impact-high-text">${item.high} alto impacto</span></small></div>`).join("")}</section>`;
  }).join("") || '<p class="empty-state">Nenhum local encontrado.</p>';
}
function renderStationRanking(source) {
  const target = document.querySelector("#stationRanking");
  const rows = stationProfiles(source).filter((item) => item.total > 0).sort((a, b) => b.score - a.score);
  target.innerHTML = rows.slice(0, 10).map((item, index) => {
    return `<article class="rank-row" data-station="${item.code}" role="button" tabindex="0"><span class="rank-position">${index + 1}</span><div class="rank-name"><strong>${item.code}</strong><span>${item.name}</span></div><strong class="rank-count">${item.total}<small> vínculos</small></strong><span class="risk-badge ${impactStatusClass(item.status)}">${item.status}</span></article>`;
  }).join("") || '<p class="empty-state">Nenhuma estação encontrada.</p>';
  target.querySelectorAll(".rank-row").forEach((row) => {
    row.addEventListener("click", () => filterCalendarByStation(row.dataset.station));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") filterCalendarByStation(row.dataset.station);
    });
  });
}
function stationProfiles(source) {
  const base = lineImpactData(source).map((item) => ({ ...item, score: item.high * 300 + item.medium * 120 + item.low * 40 + item.audience / 1000 }));
  const maxScore = Math.max(1, ...base.map((item) => item.score));
  return base.map((item) => {
    const percent = Math.round((item.score / maxScore) * 100);
    const status = percent >= 80 ? "CRÍTICO" : percent >= 55 ? "ALTO" : percent >= 30 ? "MÉDIO" : item.total ? "BAIXO" : "NORMAL";
    const eventsForStation = source.filter((event) => (event.estacoes || []).map(normalizeStationCode).includes(item.code)).sort((a, b) => String(a.data).localeCompare(String(b.data)));
    return { ...item, percent, status, eventsForStation };
  });
}
function renderStationImpactCards(source) {
  const target = document.querySelector("#stationImpactCards");
  const coverage = document.querySelector("#stationCoverageSummary");
  if (!target || !coverage) return;
  const profiles = stationProfiles(source);
  const impactedStations = profiles.filter((item) => item.total > 0).length;
  const stationLinks = profiles.reduce((sum, item) => sum + item.total, 0);
  coverage.innerHTML = `<div><span>Eventos únicos</span><strong>${formatAudience(source.length)}</strong></div><div><span>Vínculos com estações</span><strong>${formatAudience(stationLinks)}</strong></div><div><span>Estações impactadas</span><strong>${formatAudience(impactedStations)}</strong></div>`;
  target.innerHTML = profiles.map((item) => {
    const nextEvents = item.eventsForStation.slice(0, 2).map((event) => `${formatDate(event.data)} ${event.evento}`).join(" | ") || "Sem próximos eventos";
    const team = item.status === "CRÍTICO" ? "PM, GCM, Velada, Ambulância" : item.status === "ALTO" ? "PM, GCM, Velada" : item.status === "MÉDIO" ? "GCM e apoio local" : "Monitoramento";
    return `<article class="station-impact-card ${impactStatusClass(item.status)}" data-station="${item.code}"><div><strong>${item.code}</strong><span>${item.name}</span></div><div class="impact-meter"><i style="width:${item.percent}%"></i></div><div class="station-card-meta"><span>${item.percent}%</span><span>${item.status}</span><span>${item.total} vínculos</span><span>${formatAudience(item.audience)} público</span></div><p>${nextEvents}</p><small>Equipe necessária: ${team}</small></article>`;
  }).join("");
  target.querySelectorAll(".station-impact-card").forEach((card) => card.addEventListener("click", () => filterCalendarByStation(card.dataset.station)));
}
function impactStatusClass(status) {
  if (status === "CRÍTICO") return "status-critical";
  if (status === "ALTO") return "status-high";
  if (status === "MÉDIO") return "status-medium";
  if (status === "BAIXO") return "status-low";
  return "status-normal";
}
function lineImpactData(source) {
  const map = new Map(lineStations.map((station) => [station.code, { ...station, high: 0, medium: 0, low: 0, total: 0, audience: 0 }]));
  source.forEach((event) => {
    const impact = displayImpact(event.impacto);
    const stations = event.estacoes?.length ? event.estacoes : [];
    stations.forEach((station) => {
      const code = normalizeStationCode(station);
      if (!map.has(code)) return;
      const current = map.get(code);
      current.high += impact === "ALTO" ? 1 : 0;
      current.medium += impact === "MÉDIO" ? 1 : 0;
      current.low += impact === "BAIXO" ? 1 : 0;
      current.total += 1;
      current.audience += Number(event.publico || 0);
    });
  });
  return lineStations.map((station) => map.get(station.code));
}
function renderLineMap(source) {
  const target = document.querySelector("#operationalMap");
  const tooltip = document.querySelector("#lineMapTooltip");
  if (!target || !tooltip) return;
  const profiles = stationProfiles(source);
  const eventsWithStation = source.filter((event) => event.estacoes?.length).slice(0, 14);
  target.innerHTML = `<div class="map-line">${profiles.map((item, index) => `<button class="map-station ${impactStatusClass(item.status)}" type="button" style="left:${4 + index * 6.1}%" data-station="${item.code}" data-tooltip="<strong>${item.code} | ${item.name}</strong><span>${item.total} eventos</span><span>${formatAudience(item.audience)} público</span><span>Status: ${item.status}</span><span>Raio: ${item.status === "CRÍTICO" ? "1000 m" : item.status === "ALTO" ? "500 m" : "250 m"}</span>"><span></span><strong>${item.code}</strong></button>`).join("")}</div><div class="map-events">${eventsWithStation.map((event, index) => { const station = normalizeStationCode(event.estacoes[0]); const stationIndex = Math.max(0, lineStations.findIndex((item) => item.code === station)); const top = 28 + (index % 4) * 14; return `<button class="map-event ${impactClass(event.impacto)}" type="button" style="left:${5 + stationIndex * 6.1}%;top:${top}%" data-station="${station}" data-tooltip="<strong>${event.evento}</strong><span>${formatDate(event.data)} | ${event.inicio || "A definir"}</span><span>${event.local || "Local não informado"}</span><span>${formatAudience(event.publico)} pessoas</span><span>Impacto: ${displayImpact(event.impacto)}</span>"></button>`; }).join("")}</div>`;
  target.querySelectorAll("[data-tooltip]").forEach((item) => {
    item.addEventListener("mousemove", (event) => {
      const rect = target.getBoundingClientRect();
      tooltip.classList.add("visible");
      tooltip.style.left = `${event.clientX - rect.left + 14}px`;
      tooltip.style.top = `${event.clientY - rect.top + 14}px`;
      tooltip.innerHTML = item.dataset.tooltip;
    });
    item.addEventListener("mouseleave", () => tooltip.classList.remove("visible"));
    item.addEventListener("click", () => filterCalendarByStation(item.dataset.station));
  });
}
function filterCalendarByStation(station) {
  const search = document.querySelector("#searchInput");
  const impact = document.querySelector("#impactFilter");
  if (search) search.value = station || "";
  if (impact) impact.value = "";
  showView("calendarView", document.querySelector('[data-view-target="calendarView"]'));
}
function renderHourHeatmap(source) {
  const target = document.querySelector("#hourHeatmap");
  if (!target) return;
  const data = lineImpactData(source).map((station) => ({ ...station, hours: dashboardHours.reduce((acc, hour) => ({ ...acc, [hour]: 0 }), {}) }));
  source.forEach((event) => {
    const hour = eventHourSlot(event);
    (event.estacoes || []).map(normalizeStationCode).forEach((code) => {
      const station = data.find((item) => item.code === code);
      if (station) station.hours[hour] += impactWeight[displayImpact(event.impacto)] || 1;
    });
  });
  const max = Math.max(1, ...data.flatMap((item) => Object.values(item.hours)));
  target.innerHTML = `<div class="heatmap-head"></div>${dashboardHours.map((hour) => `<strong>${hour}</strong>`).join("")}${data.map((station) => `<strong>${station.code}</strong>${dashboardHours.map((hour) => `<span class="heat-level-${Math.ceil((station.hours[hour] / max) * 4)}" title="${station.name} | ${hour} | ${station.hours[hour]} pontos"></span>`).join("")}`).join("")}`;
}
function renderEventDistribution(source) {
  const legend = document.querySelector("#eventDistribution");
  const donut = document.querySelector("#eventDonut");
  if (!legend || !donut) return;
  const counts = {};
  source.forEach((event) => counts[classifyEventType(event)] = (counts[classifyEventType(event)] || 0) + 1);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const colors = ["#16365c", "#526b89", "#8a9bb0", "#b9c5d3", "#d7dee8", "#64748b"];
  let start = 0;
  const total = Math.max(1, source.length);
  const gradient = entries.map((entry, index) => {
    const size = (entry[1] / total) * 100;
    const part = `${colors[index % colors.length]} ${start}% ${start + size}%`;
    start += size;
    return part;
  }).join(", ");
  donut.style.background = entries.length ? `conic-gradient(${gradient})` : "#e2e8f0";
  donut.innerHTML = `<strong>${formatAudience(source.length)}</strong><span>eventos</span>`;
  legend.innerHTML = entries.map((entry, index) => `<div><i style="background:${colors[index % colors.length]}"></i><span>${entry[0]}</span><strong>${formatAudience(entry[1])}</strong></div>`).join("") || '<p class="empty-state">Nenhum evento encontrado.</p>';
}
function renderSmartAlerts(source) {
  const target = document.querySelector("#smartAlerts");
  if (!target) return;
  const alerts = source.map((event) => {
    const score = (impactWeight[displayImpact(event.impacto)] || 1) * Math.max(Number(event.publico || 0), 1);
    const reinforcements = [];
    if (displayImpact(event.impacto) === "ALTO" || Number(event.publico || 0) >= 30000) reinforcements.push("PM", "GCM");
    if (Number(event.publico || 0) >= 50000) reinforcements.push("Equipe Velada", "Ambulância");
    if (normalizeText(event.classificacao).includes("MANIFEST")) reinforcements.push("Monitoramento CIS");
    return { event, score, reinforcements: [...new Set(reinforcements)] };
  }).sort((a, b) => b.score - a.score).slice(0, 6);
  target.innerHTML = alerts.map((item) => `<article class="alert-card ${impactClass(item.event.impacto)}"><strong>${(item.event.estacoes || []).map(normalizeStationCode).join(", ") || "SEM ESTAÇÃO"}</strong><span>${displayImpact(item.event.impacto)} | ${item.event.evento}</span><p>${formatAudience(item.event.publico)} pessoas | ${formatDate(item.event.data)} ${item.event.inicio || ""}</p><small>Reforço recomendado: ${item.reinforcements.join(", ") || "Monitoramento"}</small></article>`).join("") || '<p class="empty-state">Sem alertas no período filtrado.</p>';
}
function dayMonthLabel(date) {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function volumeData(source, mode) {
  const grouped = new Map();
  const weekdayNames = [{ label: "Segunda-feira", shortLabel: "SEG" }, { label: "Terça-feira", shortLabel: "TER" }, { label: "Quarta-feira", shortLabel: "QUA" }, { label: "Quinta-feira", shortLabel: "QUI" }, { label: "Sexta-feira", shortLabel: "SEX" }, { label: "Sábado", shortLabel: "SÁB" }, { label: "Domingo", shortLabel: "DOM" }];
  if (mode === "weekday") weekdayNames.forEach((item, index) => grouped.set(String(index), { key: String(index), label: item.label, shortLabel: item.shortLabel, total: 0 }));
  source.forEach((event) => {
    const date = parseDate(event.data);
    if (!date) return;
    let key = event.data;
    let label = formatDate(event.data);
    let shortLabel = dayMonthLabel(date);
    if (mode === "weekday") {
      const weekdayIndex = (date.getDay() + 6) % 7;
      key = String(weekdayIndex);
      label = weekdayNames[weekdayIndex].label;
      shortLabel = weekdayNames[weekdayIndex].shortLabel;
    }
    if (mode === "month") {
      key = monthKey(event.data);
      label = monthLabel(event.data);
      shortLabel = `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getFullYear()).slice(-2)}`;
    }
    const current = grouped.get(key) || { key, label, shortLabel, total: 0 };
    current.total += 1;
    grouped.set(key, current);
  });
  return [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key));
}
function renderEventVolume(source) {
  const target = document.querySelector("#eventVolumeChart");
  const summary = document.querySelector("#eventVolumeSummary");
  if (!target || !summary) return;
  const data = volumeData(source, eventVolumeMode);
  const maximum = Math.max(1, ...data.map((item) => item.total));
  const peak = source.length ? data.reduce((best, item) => !best || item.total > best.total ? item : best, null) : null;
  const average = data.length ? source.length / data.length : 0;
  const activePeriods = data.filter((item) => item.total > 0).length;
  const periodLabel = eventVolumeMode === "date" ? "datas" : eventVolumeMode === "weekday" ? "dias da semana" : "meses";
  const periodSingular = eventVolumeMode === "date" ? "data" : eventVolumeMode === "weekday" ? "dia da semana" : "mês";
  document.querySelectorAll("[data-volume-mode]").forEach((button) => {
    const active = button.dataset.volumeMode === eventVolumeMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  summary.innerHTML = `<article><span>Total de eventos</span><strong>${source.length}</strong><small>No filtro atual</small></article><article><span>Períodos ativos</span><strong>${activePeriods}</strong><small>${periodLabel} com eventos</small></article><article><span>Média por período</span><strong>${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(average)}</strong><small>Eventos por ${periodSingular}</small></article><article><span>Maior volume</span><strong>${peak?.total || 0}</strong><small>${peak?.label || "Sem eventos"}</small></article>`;
  target.style.setProperty("--volume-columns", Math.max(4, data.length));
  target.innerHTML = data.map((item) => `<div class="volume-bar" role="img" aria-label="${item.label}: ${item.total} eventos" title="${item.label}: ${item.total} eventos"><span>${item.total}</span><i><b style="height:${item.total ? Math.max(8, (item.total / maximum) * 100) : 0}%"></b></i><small>${item.shortLabel}</small></div>`).join("") || '<p class="volume-empty">Nenhum evento neste filtro.</p>';
}
function renderMonthlyImpactChart(source) {
  const canvas = document.querySelector("#monthlyImpactChart");
  const tooltip = document.querySelector("#chartTooltip");
  if (!canvas || !tooltip) return;
  const ctx = canvas.getContext("2d");
  const data = lineImpactData(source);
  const width = canvas.width;
  const height = canvas.height;
  const padding = { top: 46, right: 92, bottom: 30, left: 280 };
  const rowHeight = (height - padding.top - padding.bottom) / data.length;
  const barHeight = 14;
  const barWidthMax = width - padding.left - padding.right;
  const maxTotal = Math.max(1, ...data.map((item) => item.total));
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.font = "700 13px Arial";
  [{ label: "Alto", color: "#d92d20" }, { label: "Médio", color: "#fdb022" }, { label: "Baixo", color: "#12b76a" }].forEach((item, index) => {
    const x = padding.left + index * 92;
    ctx.fillStyle = item.color;
    ctx.fillRect(x, 10, 12, 12);
    ctx.fillStyle = "#102033";
    ctx.fillText(item.label, x + 18, 21);
  });
  data.forEach((item, index) => {
    const y = padding.top + rowHeight * index + rowHeight / 2;
    const barWidth = Math.max(item.total ? 10 : 0, (item.total / maxTotal) * barWidthMax);
    if (index % 2 === 0) {
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(12, y - rowHeight / 2, width - 24, rowHeight);
    }
    ctx.font = "700 20px Arial";
    ctx.fillStyle = "#102033";
    ctx.fillText(item.code, 24, y + 7);
    ctx.font = "13px Arial";
    ctx.fillStyle = "#475569";
    ctx.fillText(item.name, 82, y + 5);
    ctx.font = "700 12px Arial";
    ctx.fillStyle = "#0d2748";
    ctx.fillText(`${item.total} eventos`, width - 82, y + 5);
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(padding.left, y - barHeight / 2, barWidthMax, barHeight);
    const segments = [{ value: item.high, color: "#d92d20" }, { value: item.medium, color: "#fdb022" }, { value: item.low, color: "#12b76a" }];
    let offset = 0;
    segments.forEach((segment) => {
      const segmentWidth = item.total ? (segment.value / item.total) * barWidth : 0;
      if (segmentWidth <= 0) return;
      ctx.fillStyle = segment.color;
      ctx.fillRect(padding.left + offset, y - barHeight / 2, segmentWidth, barHeight);
      offset += segmentWidth;
    });
    ctx.strokeStyle = "#dbe4ef";
    ctx.strokeRect(padding.left, y - barHeight / 2, barWidthMax, barHeight);
  });
  canvas.onmousemove = (event) => {
    const rect = canvas.getBoundingClientRect();
    const mouseY = ((event.clientY - rect.top) / rect.height) * height;
    const index = Math.max(0, Math.min(data.length - 1, Math.floor((mouseY - padding.top) / rowHeight)));
    const item = data[index];
    tooltip.classList.add("visible");
    tooltip.style.left = `${event.clientX - rect.left + 16}px`;
    tooltip.style.top = `${event.clientY - rect.top + 16}px`;
    tooltip.innerHTML = `<strong>${item.code} | ${item.name}</strong><span>Alto: ${item.high}</span><span>Médio: ${item.medium}</span><span>Baixo: ${item.low}</span><span>Total: ${item.total}</span><span>Público: ${formatAudience(item.audience)}</span>`;
  };
  canvas.onmouseleave = () => tooltip.classList.remove("visible");
}
function exportDashboardPdf() {
  showView("dashboardView", document.querySelector("#navDashboard"));
  window.setTimeout(() => window.print(), 150);
}
function render() {
  const calendarEvents = getFilteredEvents();
  const dashboardBaseEvents = events.filter(isEventInScope);
  renderDashboardFilters(dashboardBaseEvents);
  const dashboardEvents = getDashboardEvents();
  renderCalendar(calendarEvents);
  updateSummary(dashboardEvents);
  renderStationImpactCards(dashboardEvents);
  renderHourHeatmap(dashboardEvents);
  renderStationRanking(dashboardEvents);
  renderEventVolume(dashboardEvents);
  renderEditEventList();
  renderFieldReportOptions();
  applyTextOverrides();
  setTextEditState(textEditEnabled, false);
}
function monthName(dateValue) {
  const date = parseDate(dateValue);
  return date ? new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(date).toUpperCase() : "";
}
function ensureSelectValue(select, value) {
  if (!select || !value) return;
  const exists = Array.from(select.options).some((option) => normalizeText(option.value) === normalizeText(value));
  if (!exists) select.add(new Option(value, value));
  select.value = Array.from(select.options).find((option) => normalizeText(option.value) === normalizeText(value))?.value || value;
}
function updateEventImagePreview(image = "") {
  pendingEventImage = image;
  const preview = document.querySelector("#eventImagePreview");
  const previewImage = document.querySelector("#eventImagePreviewImg");
  preview.classList.toggle("hidden", !image);
  previewImage.src = image;
}
function setEventImageProcessingState(processing, message) {
  const submitButton = document.querySelector("#eventSubmitButton");
  const status = document.querySelector("#eventImageStatus");
  submitButton.disabled = processing;
  submitButton.textContent = processing ? "Processando imagem..." : editingEventId === null ? "Salvar evento" : "Salvar alterações";
  status.textContent = message;
  status.classList.toggle("processing", processing);
  status.classList.toggle("ready", !processing && !!pendingEventImage);
}
function optimizeEventImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Formato de imagem inválido."));
      image.onload = () => {
        const scale = Math.min(1, 1200 / image.width, 900 / image.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function fitEventImageModal() {
  const image = document.querySelector("#eventImageModalImg");
  const panel = document.querySelector(".image-modal-panel");
  if (!image.naturalWidth || !image.naturalHeight) return;
  const maxImageHeight = Math.max(240, window.innerHeight - 116);
  const maxImageWidth = Math.max(240, window.innerWidth - 60);
  const proportionalWidth = maxImageHeight * (image.naturalWidth / image.naturalHeight);
  const imageWidth = Math.min(image.naturalWidth, maxImageWidth, proportionalWidth);
  panel.style.width = `${Math.max(280, Math.round(imageWidth + 28))}px`;
}
function openEventImageModal(event) {
  const modal = document.querySelector("#eventImageModal");
  document.querySelector("#eventImageModalTitle").textContent = event.evento || "Imagem do evento";
  const image = document.querySelector("#eventImageModalImg");
  image.onload = fitEventImageModal;
  image.src = event.imagem;
  document.body.classList.add("image-modal-open");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}
function closeEventImageModal() {
  const modal = document.querySelector("#eventImageModal");
  document.querySelector(".image-modal-panel").style.removeProperty("width");
  document.body.classList.remove("image-modal-open");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.querySelector("#eventImageModalImg").removeAttribute("src");
}
function setEventFormMode(eventToEdit = null) {
  const form = document.querySelector("#eventForm");
  eventImageSelectionToken += 1;
  eventImageProcessing = null;
  editingEventId = eventToEdit?.id ?? null;
  form.reset();
  document.querySelector("#eventEditorTitle").textContent = eventToEdit ? "Editar evento" : "Adicionar evento";
  document.querySelector("#eventSubmitButton").textContent = eventToEdit ? "Salvar alterações" : "Salvar evento";
  document.querySelector("#deleteEventButton").classList.toggle("hidden", !eventToEdit);
  document.querySelector("#eventImageInput").value = "";
  updateEventImagePreview(eventToEdit?.imagem || "");
  setEventImageProcessingState(false, eventToEdit?.imagem ? "Imagem atual carregada." : "Nenhuma imagem selecionada.");
  if (!eventToEdit) {
    syncEventWeekday();
    return;
  }
  form.elements.evento.value = eventToEdit.evento || "";
  form.elements.data.value = eventToEdit.data || "";
  form.elements.inicio.value = /^\d{2}:\d{2}$/.test(eventToEdit.inicio || "") ? eventToEdit.inicio : "";
  form.elements.termino.value = eventToEdit.termino || "";
  form.elements.local.value = eventToEdit.local || "";
  ensureSelectValue(form.elements.classificacao, normalizeText(eventToEdit.classificacao) || "EVENTO");
  ensureSelectValue(form.elements.impacto, displayImpact(eventToEdit.impacto) || "BAIXO");
  form.elements.estacoes.value = (eventToEdit.estacoes || []).map(normalizeStationCode).join(", ");
  form.elements.publico.value = isAudienceUndisclosed(eventToEdit) ? "NÃO DIVULGADO" : String(eventToEdit.publico || "");
  ensureSelectValue(form.elements.operacaoEstendida, displayYesNo(eventToEdit.operacaoEstendida));
  ensureSelectValue(form.elements.plantaoLocal, displayYesNo(eventToEdit.plantaoLocal));
  syncEventWeekday();
}
function renderEditEventList() {
  const target = document.querySelector("#editEventList");
  if (!target) return;
  const query = normalizeText(document.querySelector("#editEventSearch")?.value);
  const source = events.filter(isEventInScope).filter((event) => !query || normalizeText([event.evento, event.local, event.data, ...(event.estacoes || [])].join(" ")).includes(query)).sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));
  target.innerHTML = source.map((event) => `<button class="edit-event-item ${impactClass(event.impacto)}" type="button" data-edit-event-id="${event.id}"><span class="edit-event-item-date"><strong>${dayNumber(event.data)}</strong>${weekday(event.data)}</span><span class="edit-event-item-copy"><strong>${event.evento || "Evento sem nome"}</strong><span>${formatDate(event.data)} | ${event.local || "Local não informado"}</span></span><span class="edit-event-item-action">Editar</span></button>`).join("") || '<p class="empty-state">Nenhum evento encontrado.</p>';
}
function openDrawer(id) {
  const drawer = document.querySelector(id);
  if (!drawer) return;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
}
function showView(targetId, activeButton) {
  document.querySelectorAll(".side-link").forEach((item) => item.classList.remove("active"));
  if (activeButton) activeButton.classList.add("active");
  document.querySelectorAll(".view-panel").forEach((panel) => panel.classList.remove("active"));
  document.querySelector(`#${targetId}`).classList.add("active");
  render();
}
function closeDrawer(type) {
  const drawer = document.querySelector(type === "dashboard" ? "#dashboardDrawer" : type === "admin" ? "#adminDrawer" : type === "edit-events" ? "#editEventsDrawer" : "#editorDrawer");
  if (!drawer) return;
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
}
function openPasswordModal(mode) {
  passwordMode = mode;
  const modal = document.querySelector("#passwordModal");
  const isChange = mode === "change";
  const isDashboard = mode === "dashboard";
  const isAdmin = mode === "admin";
  const isFieldReport = mode === "field-report";
  document.querySelector("#passwordForm").classList.remove("hidden");
  document.querySelector("#accessRequestForm").classList.add("hidden");
  document.querySelector("#openAccessRequest").classList.toggle("hidden", !isFieldReport);
  document.querySelector("#passwordTitle").textContent = isDashboard ? "Painel de impacto" : isFieldReport ? "Relatório de campo" : isAdmin ? "Acesso restrito" : isChange ? "Alterar senha" : "Editar textos";
  document.querySelector("#passwordSubmit").textContent = isDashboard ? "Acessar painel" : isFieldReport ? "Acessar relatório" : isAdmin ? "Acessar" : isChange ? "Salvar senha" : "Entrar";
  document.querySelector("#currentPasswordLabel").firstChild.textContent = isChange ? "Senha atual" : "Senha";
  document.querySelector("#newPasswordLabel").classList.toggle("hidden", !isChange);
  document.querySelector("#passwordError").textContent = "";
  document.querySelector("#currentPassword").value = "";
  document.querySelector("#newPassword").value = "";
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.querySelector("#currentPassword").focus();
}
function closePasswordModal() {
  const modal = document.querySelector("#passwordModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}
function showAccessRequestForm() {
  document.querySelector("#passwordForm").classList.add("hidden");
  document.querySelector("#accessRequestForm").classList.remove("hidden");
  document.querySelector("#requestCorporateEmail").focus();
}
function showFieldReportPasswordForm() {
  document.querySelector("#accessRequestForm").classList.add("hidden");
  document.querySelector("#passwordForm").classList.remove("hidden");
  document.querySelector("#currentPassword").focus();
}
function showPasswordError(message) {
  document.querySelector("#passwordError").textContent = message;
}
function setTextEditState(enabled, updateButton = true) {
  textEditEnabled = enabled;
  document.body.classList.toggle("text-editing", enabled);
  document.querySelector("#editNotice").classList.toggle("visible", enabled);
  document.querySelector("#changeTextPassword").classList.toggle("hidden", !enabled);
  if (updateButton) document.querySelector("#toggleTextEdit").textContent = enabled ? "Bloquear textos" : "Editar textos";
  document.querySelectorAll("[data-edit-id], [data-event-field]").forEach((element) => {
    element.contentEditable = enabled ? "true" : "false";
    element.spellcheck = true;
  });
}
function applyEditModeToDynamicText() {
  document.querySelectorAll("[data-event-field]").forEach((element) => {
    element.contentEditable = textEditEnabled ? "true" : "false";
    element.addEventListener("blur", () => saveEventTextEdit(element));
  });
}
function saveEventTextEdit(element) {
  if (!textEditEnabled) return;
  const id = Number(element.dataset.eventId);
  const field = element.dataset.eventField;
  const event = events.find((item) => Number(item.id) === id);
  if (!event || field === "monthLabel") return;
  const value = element.textContent.trim();
  if (field === "estacoes") event.estacoes = value.split(/[,;/]/).map((item) => normalizeText(item)).filter(Boolean);
  else if (field === "publico") {
    event.publicoNaoDivulgado = normalizeText(value).includes("NAO DIVULGADO");
    event.publico = event.publicoNaoDivulgado ? 0 : Number(value.replace(/\D/g, "")) || 0;
  }
  else if (field === "impacto") event.impacto = displayImpact(value);
  else event[field] = value;
  saveEvents();
}
document.querySelector("#toggleTextEdit").addEventListener("click", () => {
  if (textEditEnabled) {
    setTextEditState(false);
    return;
  }
  openPasswordModal("unlock");
});
document.querySelector("#changeTextPassword").addEventListener("click", () => {
  openPasswordModal("change");
});
document.querySelector("#adminAccess").addEventListener("click", () => {
  requestAdminAccess();
});
document.addEventListener("keydown", (event) => {
  if (!PUBLIC_STATIC_MODE && event.ctrlKey && event.altKey && normalizeText(event.key) === "C") requestAdminAccess();
});
document.querySelector("#closePasswordModal").addEventListener("click", closePasswordModal);
document.querySelector("[data-password-close]").addEventListener("click", closePasswordModal);
document.querySelector("#openAccessRequest").addEventListener("click", showAccessRequestForm);
document.querySelector("#backToPassword").addEventListener("click", showFieldReportPasswordForm);
document.querySelector("#closeAccessRequest").addEventListener("click", closePasswordModal);
document.querySelector("#accessRequestForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const email = document.querySelector("#requestCorporateEmail").value.trim();
  const jobTitle = document.querySelector("#requestJobTitle").value.trim();
  if (!event.currentTarget.reportValidity()) return;
  const subject = "Solicitação de acesso | Relatório de campo";
  const body = [`SOLICITAÇÃO DE ACESSO`, ``, `E-mail corporativo: ${email}`, `Cargo: ${jobTitle}`, ``, `Solicito acesso ao Relatório de campo do Centro de Inteligência e Segurança.`].join("\n");
  window.location.href = `mailto:inteligencia@linhauni.com.br?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  closePasswordModal();
});
document.querySelector("#passwordForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const current = document.querySelector("#currentPassword").value;
  const next = document.querySelector("#newPassword").value.trim();
  const expectedPassword = passwordMode === "dashboard" ? getDashboardPassword() : getTextPassword();
  if (current !== expectedPassword) {
    showPasswordError("Senha incorreta.");
    return;
  }
  if (passwordMode === "dashboard") {
    showView("dashboardView", document.querySelector("#navDashboard"));
  } else if (passwordMode === "admin") {
    grantAdminSession();
    openDrawer("#adminDrawer");
  } else if (passwordMode === "field-report") {
    grantAdminSession();
    showView("fieldReportView", document.querySelector("#navFieldReport"));
  } else if (passwordMode === "change") {
    if (next.length < 4) {
      showPasswordError("A nova senha precisa ter pelo menos 4 caracteres.");
      return;
    }
    localStorage.setItem(PASSWORD_STORAGE_KEY, next);
  } else {
    setTextEditState(true);
  }
  closePasswordModal();
});
document.addEventListener("blur", (event) => {
  const element = event.target;
  if (!textEditEnabled || !element?.dataset?.editId) return;
  saveTextOverride(element.dataset.editId, element.textContent.trim());
}, true);
document.addEventListener("input", (event) => {
  const element = event.target;
  if (!textEditEnabled || !element?.dataset) return;
  if (element.dataset.editId) saveTextOverride(element.dataset.editId, element.textContent.trim());
  if (element.dataset.eventField) saveEventTextEdit(element);
});
document.querySelector("#openEditor").addEventListener("click", () => {
  setEventFormMode();
  openDrawer("#editorDrawer");
});
document.querySelector("#openDashboard").addEventListener("click", () => showView("dashboardView", document.querySelector("#navDashboard")));
document.querySelector("#navDashboard").addEventListener("click", () => {
  showView("dashboardView", document.querySelector("#navDashboard"));
});
document.querySelector("#navFieldReport").addEventListener("click", requestFieldReportAccess);
document.querySelectorAll("[data-view-target]").forEach((button) => {
  button.addEventListener("click", () => {
    showView(button.dataset.viewTarget, button);
  });
});
document.querySelector("#fieldReportEvent").addEventListener("change", loadFieldReportForSelectedEvent);
document.querySelector("#fieldImpactOccurred").addEventListener("change", (event) => {
  if (event.target.value === "NÃO") {
    document.querySelector("#fieldImpactLevel").value = "SEM IMPACTO";
    document.querySelector("#fieldImpactType").value = "SEM IMPACTO";
    document.querySelector("#fieldImpactedStations").value = "";
  } else if (event.target.value === "SIM") {
    if (document.querySelector("#fieldImpactLevel").value === "SEM IMPACTO") document.querySelector("#fieldImpactLevel").value = "BAIXO";
    if (document.querySelector("#fieldImpactType").value === "SEM IMPACTO") document.querySelector("#fieldImpactType").value = "FLUXO";
  }
});
document.querySelector("#fieldReportForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const report = captureFieldReport();
  if (!report) return;
  openReportRecipientModal(report);
});
document.querySelector("#closeReportRecipient").addEventListener("click", closeReportRecipientModal);
document.querySelector("[data-recipient-close]").addEventListener("click", closeReportRecipientModal);
document.querySelector("#reportRecipientForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.querySelector("#reportRecipientEmail").value.trim();
  if (!isAllowedReportEmail(email)) {
    document.querySelector("#reportRecipientError").textContent = "Informe um e-mail válido terminado em @linhauni.com.br.";
    return;
  }
  if (!pendingFieldReport) return;
  const report = { ...pendingFieldReport, emailDestinatario: email, atualizadoEm: new Date().toISOString() };
  if (!storeFieldReport(report)) return;
  closeReportRecipientModal();
  await emailFieldReport(report);
});
document.querySelector("#exportFieldReportPdf").addEventListener("click", () => {
  const report = captureFieldReport();
  if (report) exportFieldReport(report);
});
document.querySelector("#emailFieldReport").addEventListener("click", () => {
  const report = captureFieldReport();
  if (report) emailFieldReport(report);
});
document.querySelector("#adminOpenEditor").addEventListener("click", () => {
  closeDrawer("admin");
  setEventFormMode();
  openDrawer("#editorDrawer");
});
document.querySelector("#adminEditEvents").addEventListener("click", () => {
  closeDrawer("admin");
  document.querySelector("#editEventSearch").value = "";
  renderEditEventList();
  openDrawer("#editEventsDrawer");
});
document.querySelector("#adminExportBackup").addEventListener("click", () => {
  exportSiteBackup();
  closeDrawer("admin");
});
document.querySelector("#adminToggleTextEdit").addEventListener("click", () => {
  setTextEditState(!textEditEnabled);
  document.querySelector("#adminToggleTextEdit").textContent = textEditEnabled ? "Bloquear textos" : "Editar textos";
});
document.querySelector("#adminChangePassword").addEventListener("click", () => openPasswordModal("change"));
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeDrawer(button.dataset.close)));
document.querySelector("#editEventSearch").addEventListener("input", renderEditEventList);
document.querySelector("#editEventList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-event-id]");
  if (!button) return;
  const selectedEvent = events.find((item) => String(item.id) === String(button.dataset.editEventId));
  if (!selectedEvent) return;
  closeDrawer("edit-events");
  setEventFormMode(selectedEvent);
  openDrawer("#editorDrawer");
});
document.querySelector("#eventImageInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    window.alert("Selecione uma imagem JPG, PNG ou WebP.");
    event.target.value = "";
    return;
  }
  const selectionToken = ++eventImageSelectionToken;
  setEventImageProcessingState(true, "Processando a nova imagem...");
  try {
    eventImageProcessing = optimizeEventImage(file);
    const optimizedImage = await eventImageProcessing;
    if (selectionToken !== eventImageSelectionToken) return;
    updateEventImagePreview(optimizedImage);
    setEventImageProcessingState(false, "Nova imagem pronta para salvar.");
  } catch (error) {
    if (selectionToken !== eventImageSelectionToken) return;
    window.alert(error.message);
    event.target.value = "";
    setEventImageProcessingState(false, pendingEventImage ? "Imagem anterior mantida." : "Nenhuma imagem selecionada.");
  } finally {
    if (selectionToken === eventImageSelectionToken) eventImageProcessing = null;
  }
});
document.querySelector("#removeEventImage").addEventListener("click", () => {
  eventImageSelectionToken += 1;
  eventImageProcessing = null;
  document.querySelector("#eventImageInput").value = "";
  updateEventImagePreview("");
  setEventImageProcessingState(false, "A imagem será removida ao salvar.");
});
document.querySelector("#deleteEventButton").addEventListener("click", () => {
  if (editingEventId === null) return;
  const selectedEvent = events.find((item) => String(item.id) === String(editingEventId));
  if (!selectedEvent) return;
  const confirmed = window.confirm(`Excluir definitivamente o evento "${selectedEvent.evento || "Evento sem nome"}"?`);
  if (!confirmed) return;
  const eventsBeforeDelete = [...events];
  events = events.filter((item) => String(item.id) !== String(editingEventId));
  if (!saveEvents()) {
    events = eventsBeforeDelete;
    window.alert("Não foi possível excluir o evento.");
    return;
  }
  editingEventId = null;
  eventImageSelectionToken += 1;
  eventImageProcessing = null;
  document.querySelector("#eventForm").reset();
  updateEventImagePreview("");
  setEventImageProcessingState(false, "Nenhuma imagem selecionada.");
  closeDrawer("editor");
  render();
});
document.querySelector("#calendarGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-event-image]");
  if (!button) return;
  const selectedEvent = events.find((item) => String(item.id) === String(button.dataset.eventImage));
  if (selectedEvent?.imagem) openEventImageModal(selectedEvent);
});
document.querySelector("#closeEventImageModal").addEventListener("click", closeEventImageModal);
document.querySelector("[data-image-close]").addEventListener("click", closeEventImageModal);
window.addEventListener("resize", () => {
  if (document.querySelector("#eventImageModal").classList.contains("open")) fitEventImageModal();
});
document.querySelector("#eventForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (eventImageProcessing) await eventImageProcessing;
  const form = new FormData(event.currentTarget);
  const dateValue = form.get("data");
  if (String(dateValue || "") < MIN_EVENT_DATE) {
    window.alert("Somente eventos a partir de julho de 2026 podem ser cadastrados.");
    return;
  }
  const rawAudience = String(form.get("publico") || "").trim();
  const publicoNaoDivulgado = normalizeText(rawAudience).includes("NAO DIVULGADO");
  const record = { id: editingEventId ?? Date.now(), mes: monthName(dateValue), data: dateValue, inicio: normalizeText(form.get("inicio")), termino: normalizeText(form.get("termino")) || "A DEFINIR", diaSemana: weekday(dateValue), classificacao: normalizeText(form.get("classificacao")), evento: normalizeText(form.get("evento")), local: normalizeText(form.get("local")), impacto: displayImpact(form.get("impacto")), estacoes: String(form.get("estacoes") || "").split(/[,;/]/).map((item) => normalizeText(item)).filter(Boolean), publico: publicoNaoDivulgado ? 0 : Number(rawAudience.replace(/\D/g, "")) || 0, publicoNaoDivulgado, imagem: pendingEventImage, operacaoEstendida: displayYesNo(form.get("operacaoEstendida")), plantaoLocal: displayYesNo(form.get("plantaoLocal")) };
  const eventsBeforeSave = [...events];
  const editingIndex = editingEventId === null ? -1 : events.findIndex((item) => String(item.id) === String(editingEventId));
  if (editingIndex >= 0) events[editingIndex] = { ...events[editingIndex], ...record, id: events[editingIndex].id };
  else events.push(record);
  if (!saveEvents()) {
    events = eventsBeforeSave;
    window.alert("A imagem não pôde ser salva. Tente selecionar uma imagem menor.");
    return;
  }
  event.currentTarget.reset();
  editingEventId = null;
  updateEventImagePreview("");
  setEventImageProcessingState(false, "Nenhuma imagem selecionada.");
  syncEventWeekday();
  closeDrawer("editor");
  render();
});
["input", "change", "blur"].forEach((eventName) => document.querySelector("#eventDate").addEventListener(eventName, syncEventWeekday));
document.querySelector("#resetData").addEventListener("click", () => {
  events = structuredClone(baseEvents).filter(isEventInScope);
  saveEvents();
  render();
});
document.querySelector("#exportJson").addEventListener("click", () => {
  exportDashboardPdf();
});
const dashboardActionsMenu = document.querySelector("#dashboardActionsMenu");
document.querySelector("#refreshDashboard").addEventListener("click", () => {
  render();
  dashboardActionsMenu.removeAttribute("open");
});
document.querySelector("#exportDashboardPdf").addEventListener("click", () => {
  dashboardActionsMenu.removeAttribute("open");
  exportDashboardPdf();
});
document.addEventListener("click", (event) => {
  if (dashboardActionsMenu.open && !dashboardActionsMenu.contains(event.target)) dashboardActionsMenu.removeAttribute("open");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") dashboardActionsMenu.removeAttribute("open");
  if (event.key === "Escape") closeEventImageModal();
});
document.querySelectorAll("[data-volume-mode]").forEach((button) => button.addEventListener("click", () => {
  eventVolumeMode = button.dataset.volumeMode;
  renderEventVolume(getDashboardEvents());
}));
["#dashboardSearch", "#dashboardCategory", "#dashboardStation", "#dashboardImpact"].forEach((selector) => document.querySelector(selector).addEventListener("input", render));
document.querySelector("#importJson").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const payload = JSON.parse(text);
  events = Array.isArray(payload) ? payload : payload.events;
  if (!Array.isArray(events)) events = structuredClone(baseEvents);
  events = events.filter(isEventInScope);
  saveEvents();
  render();
  event.target.value = "";
});
["#searchInput", "#impactFilter", "#calendarStart", "#calendarEnd"].forEach((selector) => document.querySelector(selector).addEventListener("input", render));
document.querySelector("#clearCalendarPeriod").addEventListener("click", () => {
  document.querySelector("#calendarStart").value = MIN_EVENT_DATE;
  document.querySelector("#calendarEnd").value = "";
  render();
});
applyTextOverrides();
syncEventWeekday();
render();
syncFromBackend();
