// ─── InstaLawn Quote — Demo Client ────────────────────────────────────────
// Calls the real Gemini API via /api/generate, renders results with toggleable line items.

// ─── State ────────────────────────────────────────────────────────────────
const state = {
  step: 1,
  proposal: null,       // full LandscapeProposal from API
  enabledItems: [],     // indices of items that are "checked on"
  imageData: null,      // { data: base64, mimeType }
};

// ─── Formatting ───────────────────────────────────────────────────────────
const fmt = n => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });

// ─── Step navigation ─────────────────────────────────────────────────────
function goToStep(n) {
  if (n === 3 && (!state.proposal || getEnabledItems().length === 0)) return;
  state.step = n;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getEnabledItems() {
  if (!state.proposal) return [];
  return state.enabledItems.map(i => state.proposal.items[i]).filter(Boolean);
}

function calcTotals() {
  const items = getEnabledItems();
  const subtotal = items.reduce((s, li) => s + li.totalPrice, 0);
  const rebate = state.proposal?.rebateInfo?.eligible ? state.proposal.rebateInfo.estimatedRebate : 0;
  const taxable = Math.max(0, subtotal - rebate);
  const tax = taxable * 0.086;
  const net = subtotal - rebate + tax;
  return { subtotal, rebate, tax, net };
}

// ─── Generate Estimate (Step 1 → API → Step 2) ──────────────────────────
async function generateEstimate() {
  const address = document.getElementById("address-input").value.trim();
  if (address.length < 5) {
    showError("Please enter a full address (e.g. 8421 E Desert View Dr, Scottsdale, AZ)");
    return;
  }

  hideError();
  showLoading(true);

  // Cycle through loading messages
  const messages = [
    "Pulling satellite data for this property",
    "Detecting structures, hardscape & vegetation",
    "Measuring lot area and renovatable space",
    "Calculating material quantities & pricing",
    "Applying regional rates & rebate eligibility",
    "Assembling your proposal..."
  ];
  let msgIdx = 0;
  const msgInterval = setInterval(() => {
    msgIdx = (msgIdx + 1) % messages.length;
    const el = document.getElementById("loading-status");
    if (el) el.textContent = messages[msgIdx];
  }, 2500);

  try {
    const body = { address };
    if (state.imageData) {
      body.image = state.imageData;
    }

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Server error");
    }

    state.proposal = await res.json();
    // Enable all items by default
    state.enabledItems = state.proposal.items.map((_, i) => i);
    state.step = 2;
    render();
  } catch (err) {
    showError(err.message || "Something went wrong. Please try again.");
  } finally {
    clearInterval(msgInterval);
    showLoading(false);
  }
}

// ─── Toggle a line item on/off ───────────────────────────────────────────
function toggleLineItem(index) {
  const pos = state.enabledItems.indexOf(index);
  if (pos >= 0) {
    state.enabledItems.splice(pos, 1);
  } else {
    state.enabledItems.push(index);
    state.enabledItems.sort((a, b) => a - b);
  }
  renderStep2();
  renderSidebar();
  renderMobileBar();
  updateContinueBtn();
}

// ─── UI helpers ──────────────────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById("error-msg");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function hideError() {
  document.getElementById("error-msg").classList.add("hidden");
}
function showLoading(show) {
  document.getElementById("loading-overlay").classList.toggle("hidden", !show);
}
function updateContinueBtn() {
  const btn = document.getElementById("step2-continue");
  if (btn) btn.disabled = getEnabledItems().length === 0;
}

// ─── Image upload handling ───────────────────────────────────────────────
function setupImageUpload() {
  const input = document.getElementById("image-input");
  const area = document.getElementById("upload-area");
  const placeholder = document.getElementById("upload-placeholder");
  const preview = document.getElementById("upload-preview");
  const filename = document.getElementById("upload-filename");
  const removeBtn = document.getElementById("remove-image");

  if (!input) return;

  input.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readImage(file);
  });

  // Drag & drop
  area.addEventListener("dragover", (e) => { e.preventDefault(); area.classList.add("border-[#2a7d5f]/40", "bg-gray-50"); });
  area.addEventListener("dragleave", () => { area.classList.remove("border-[#2a7d5f]/40", "bg-gray-50"); });
  area.addEventListener("drop", (e) => {
    e.preventDefault();
    area.classList.remove("border-[#2a7d5f]/40", "bg-gray-50");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) readImage(file);
  });

  removeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    state.imageData = null;
    input.value = "";
    placeholder.classList.remove("hidden");
    preview.classList.add("hidden");
  });

  function readImage(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(",")[1];
      state.imageData = { data: base64, mimeType: file.type };
      filename.textContent = file.name;
      placeholder.classList.add("hidden");
      preview.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  }
}

// ─── Master render ───────────────────────────────────────────────────────
function render() {
  renderStepIndicator();

  document.getElementById("step-1").classList.toggle("hidden", state.step !== 1);
  document.getElementById("step-2").classList.toggle("hidden", state.step !== 2);
  document.getElementById("step-3").classList.toggle("hidden", state.step !== 3);

  if (state.step === 2) { renderStep2(); renderSidebar(); renderMobileBar(); updateContinueBtn(); }
  if (state.step === 3) renderStep3();
  if (state.step !== 2) hideMobileBar();
}

function renderStepIndicator() {
  const steps = [
    { n: 1, label: "Enter Address", icon: "fa-map-marker-alt" },
    { n: 2, label: "Select Services", icon: "fa-check-double" },
    { n: 3, label: "Final Quote", icon: "fa-file-invoice-dollar" },
  ];
  const el = document.getElementById("step-indicator");
  if (!el) return;

  el.innerHTML = steps.map(s => {
    const done = state.step > s.n;
    const active = state.step === s.n;
    const circle = done ? "bg-[#2a7d5f] text-white" : active ? "bg-[#2a7d5f] text-white ring-4 ring-[#2a7d5f]/20" : "bg-gray-200 text-gray-400";
    const label = active ? "text-[#2a7d5f] font-bold" : done ? "text-[#2a7d5f]" : "text-gray-400";
    const line = done ? "bg-[#2a7d5f]" : "bg-gray-200";
    const clickable = s.n <= state.step && s.n < 3;

    return `
      <div class="flex items-center ${s.n < 3 ? 'flex-1' : ''}">
        <button ${clickable ? `onclick="goToStep(${s.n})"` : ''} class="flex flex-col items-center ${clickable ? 'cursor-pointer' : 'cursor-default'}">
          <div class="w-10 h-10 rounded-full ${circle} flex items-center justify-center text-sm font-bold transition-all duration-300">
            ${done ? '<i class="fas fa-check text-sm"></i>' : `<i class="fas ${s.icon} text-xs"></i>`}
          </div>
          <span class="mt-2 text-xs ${label} hidden sm:block">${s.label}</span>
        </button>
        ${s.n < 3 ? `<div class="flex-1 h-1 ${line} mx-3 rounded transition-all duration-300"></div>` : ''}
      </div>`;
  }).join('');
}

// ─── Step 2: AI Results with toggleable items ────────────────────────────
function renderStep2() {
  const p = state.proposal;
  if (!p) return;

  // AI observations banner
  const obsEl = document.getElementById("ai-observations");
  if (obsEl) {
    const rebateHtml = p.rebateInfo?.eligible ? `
      <div class="mt-3 flex items-center gap-2 bg-emerald-50 rounded-lg px-3 py-2">
        <i class="fas fa-tag text-emerald-600 text-sm"></i>
        <span class="text-sm text-emerald-700"><strong>${fmt(p.rebateInfo.estimatedRebate)}</strong> rebate may apply — ${p.rebateInfo.program}</span>
      </div>` : '';

    obsEl.innerHTML = `
      <div class="flex items-start gap-4">
        <div class="w-10 h-10 rounded-xl feature-icon-bg flex items-center justify-center flex-shrink-0">
          <i class="fas fa-satellite text-white text-sm"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <h4 class="font-bold text-[#1a3c34]">AI Property Analysis</h4>
            <span class="text-xs px-2 py-0.5 rounded-full ${p.confidenceLevel === 'high' ? 'bg-green-100 text-green-700' : p.confidenceLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}">${p.confidenceLevel} confidence</span>
          </div>
          <p class="text-sm text-gray-600">${p.visualObservations}</p>
          ${p.existingFeatures?.length ? `
            <div class="mt-2 flex flex-wrap gap-1.5">
              ${p.existingFeatures.map(f => `<span class="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">${f}</span>`).join('')}
            </div>` : ''}
          ${rebateHtml}
        </div>
      </div>
    `;
  }

  // Line items
  const grid = document.getElementById("line-items-grid");
  if (!grid) return;

  // Group items by category
  const grouped = {};
  p.items.forEach((item, idx) => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push({ ...item, _idx: idx });
  });

  let html = '';
  for (const [cat, items] of Object.entries(grouped)) {
    html += `
      <div class="mb-6">
        <h3 class="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">${cat}</h3>
        <div class="space-y-2">
          ${items.map(item => {
            const on = state.enabledItems.includes(item._idx);
            return `
              <div onclick="toggleLineItem(${item._idx})"
                class="flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all duration-200
                ${on ? 'border-[#2a7d5f] bg-emerald-50/50' : 'border-gray-100 bg-white opacity-60 hover:opacity-80'}">
                <div class="flex items-center gap-3 flex-1 min-w-0">
                  <div class="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-all
                    ${on ? 'bg-[#2a7d5f] border-[#2a7d5f]' : 'border-gray-300'}">
                    ${on ? '<i class="fas fa-check text-white text-[10px]"></i>' : ''}
                  </div>
                  <div class="min-w-0">
                    <p class="font-semibold text-sm text-[#1a3c34] leading-tight">${item.description}</p>
                    <p class="text-xs text-gray-400 mt-0.5">${item.quantity} ${item.unit}</p>
                  </div>
                </div>
                <span class="font-bold text-sm ${on ? 'text-[#2a7d5f]' : 'text-gray-400'} flex-shrink-0 ml-3">${fmt(item.totalPrice)}</span>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  grid.innerHTML = html;
}

// ─── Sidebar quote (desktop) ─────────────────────────────────────────────
function renderSidebar() {
  const el = document.getElementById("sidebar-quote");
  if (!el || state.step !== 2) return;

  const items = getEnabledItems();
  const p = state.proposal;

  if (items.length === 0) {
    el.innerHTML = `
      <div class="bg-white rounded-2xl card-shadow p-6">
        <div class="flex items-center gap-2.5 mb-4">
          <div class="w-8 h-8 rounded-lg feature-icon-bg flex items-center justify-center">
            <i class="fas fa-leaf text-white text-sm"></i>
          </div>
          <span class="font-bold text-base text-[#1a3c34]" style="font-family:'Manrope',sans-serif;">InstaLawn Quote</span>
        </div>
        <div class="text-center py-6">
          <p class="text-sm text-gray-400">Select at least one service</p>
        </div>
      </div>`;
    return;
  }

  const t = calcTotals();

  el.innerHTML = `
    <div class="bg-white rounded-2xl card-shadow p-6">
      <div class="mb-4">
        <div class="flex items-center gap-2.5 mb-1.5">
          <div class="w-8 h-8 rounded-lg feature-icon-bg flex items-center justify-center">
            <i class="fas fa-leaf text-white text-sm"></i>
          </div>
          <span class="font-bold text-base text-[#1a3c34]" style="font-family:'Manrope',sans-serif;">InstaLawn Quote</span>
        </div>
        <p class="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Estimate Summary</p>
        <p class="text-sm text-gray-500 mt-1">${p.address}</p>
      </div>

      <div class="space-y-2 text-sm border-t border-gray-100 pt-3 max-h-52 overflow-y-auto">
        ${items.map(li => `
          <div class="flex justify-between items-start">
            <div class="min-w-0 flex-1 mr-3">
              <p class="font-semibold text-[#1a3c34] text-sm leading-tight truncate">${li.description}</p>
              <p class="text-xs text-gray-400">${li.quantity} ${li.unit}</p>
            </div>
            <span class="font-bold text-[#1a3c34] text-sm flex-shrink-0">${fmt(li.totalPrice)}</span>
          </div>
        `).join('')}
      </div>

      <div class="mt-4 pt-3 border-t border-gray-200 space-y-1.5 text-sm">
        <div class="flex justify-between text-gray-500"><span>Subtotal</span><span>${fmt(t.subtotal)}</span></div>
        ${t.rebate > 0 ? `
        <div class="flex justify-between text-[#2a7d5f] font-medium">
          <span><i class="fas fa-tag text-[10px] mr-1"></i>${p.rebateInfo.city} Rebate</span>
          <span>-${fmt(t.rebate)}</span>
        </div>` : ''}
        <div class="flex justify-between text-gray-500"><span>Est. Tax</span><span>${fmt(t.tax)}</span></div>
        <div class="flex justify-between items-center pt-2 border-t border-gray-200 mt-1">
          <span class="font-bold text-[#1a3c34]">Net Cost</span>
          <span class="font-bold text-xl text-[#2a7d5f]">${fmt(t.net)}</span>
        </div>
      </div>

      <button onclick="goToStep(3)" class="mt-4 w-full py-3 cta-gradient text-white font-bold rounded-xl text-sm hover:shadow-xl transition">
        View Final Quote <i class="fas fa-arrow-right ml-1"></i>
      </button>
    </div>`;
}

// ─── Mobile bottom bar ───────────────────────────────────────────────────
function renderMobileBar() {
  const el = document.getElementById("mobile-bar");
  if (!el) return;
  const items = getEnabledItems();
  if (state.step !== 2 || items.length === 0) { hideMobileBar(); return; }

  const t = calcTotals();
  el.classList.remove("translate-y-full");
  el.innerHTML = `
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm text-gray-500">${items.length} service${items.length !== 1 ? 's' : ''}</p>
        <p class="text-xl font-bold text-[#2a7d5f]">${fmt(t.net)}</p>
      </div>
      <button onclick="goToStep(3)" class="px-6 py-3 cta-gradient text-white font-bold rounded-xl text-sm hover:shadow-xl transition">
        View Quote <i class="fas fa-arrow-right ml-1"></i>
      </button>
    </div>`;
}

function hideMobileBar() {
  const el = document.getElementById("mobile-bar");
  if (el) el.classList.add("translate-y-full");
}

// ─── Step 3: Final quote card ────────────────────────────────────────────
function renderStep3() {
  const el = document.getElementById("step-3-content");
  if (!el || !state.proposal) return;

  const p = state.proposal;
  const items = getEnabledItems();
  const t = calcTotals();

  const itemsHtml = items.map(li => `
    <div class="flex justify-between items-start">
      <div>
        <p class="font-semibold text-[#1a3c34]">${li.description}</p>
        <p class="text-xs text-gray-400">${li.quantity} ${li.unit}</p>
      </div>
      <span class="font-bold text-[#1a3c34]">${fmt(li.totalPrice)}</span>
    </div>`).join('');

  const recsHtml = p.recommendations?.length ? `
    <div class="mt-6 bg-gray-50 rounded-xl p-5">
      <h4 class="text-sm font-bold text-[#1a3c34] mb-3"><i class="fas fa-lightbulb text-amber-500 mr-2"></i>AI Recommendations</h4>
      <ul class="space-y-2">
        ${p.recommendations.map(r => `<li class="text-sm text-gray-600 flex items-start gap-2"><i class="fas fa-check-circle text-[#2a7d5f] mt-0.5 flex-shrink-0"></i><span>${r}</span></li>`).join('')}
      </ul>
    </div>` : '';

  el.innerHTML = `
    <div class="max-w-lg mx-auto">
      <div class="relative">
        <div class="bg-white rounded-2xl card-shadow p-6 md:p-8">
          <!-- Header -->
          <div class="mb-5">
            <div class="flex items-center gap-2.5 mb-1.5">
              <div class="w-8 h-8 rounded-lg feature-icon-bg flex items-center justify-center">
                <i class="fas fa-leaf text-white text-sm"></i>
              </div>
              <span class="font-bold text-base text-[#1a3c34]" style="font-family:'Manrope',sans-serif;">InstaLawn Quote</span>
            </div>
            <p class="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Estimate Summary</p>
            <p class="text-sm text-gray-500 mt-1">${p.address}</p>
          </div>

          <!-- Area info -->
          <div class="flex flex-wrap gap-3 mb-4">
            <span class="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">Lot: ${(p.totalLotSqFt || 0).toLocaleString()} sq ft</span>
            <span class="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">Renovatable: ${(p.renovatableAreaSqFt || 0).toLocaleString()} sq ft</span>
            ${p.existingGrassSqFt ? `<span class="text-xs bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full">Grass: ${p.existingGrassSqFt.toLocaleString()} sq ft</span>` : ''}
          </div>

          <!-- Line items -->
          <div class="space-y-3 text-sm border-t border-gray-100 pt-4 max-h-80 overflow-y-auto">
            ${itemsHtml}
          </div>

          <!-- Totals -->
          <div class="mt-5 pt-4 border-t border-gray-200 space-y-2 text-sm">
            <div class="flex justify-between text-gray-500"><span>Subtotal</span><span>${fmt(t.subtotal)}</span></div>
            ${t.rebate > 0 ? `
            <div class="flex justify-between text-[#2a7d5f] font-medium">
              <span><i class="fas fa-tag text-[10px] mr-1"></i>${p.rebateInfo.city} Rebate</span>
              <span>-${fmt(t.rebate)}</span>
            </div>` : ''}
            <div class="flex justify-between text-gray-500"><span>Estimated Tax (8.6%)</span><span>${fmt(t.tax)}</span></div>
            <div class="flex justify-between items-center pt-3 border-t border-gray-200 mt-2">
              <span class="font-bold text-lg text-[#1a3c34]">Net Cost</span>
              <span class="font-bold text-2xl text-[#2a7d5f]">${fmt(t.net)}</span>
            </div>
          </div>

          <!-- Confidence & CTA -->
          <div class="mt-5 space-y-3">
            <div class="flex items-center gap-2 text-xs text-gray-400">
              <span class="w-2 h-2 ${p.confidenceLevel === 'high' ? 'bg-green-400' : p.confidenceLevel === 'medium' ? 'bg-amber-400' : 'bg-gray-400'} rounded-full inline-block flex-shrink-0"></span>
              ${p.imageAnalyzed ? 'Image analyzed' : 'Satellite estimate'} &middot; ${p.confidenceLevel} confidence
            </div>
            <button onclick="showSuccessModal()" class="w-full py-3.5 cta-gradient text-white font-bold rounded-xl text-sm hover:shadow-xl transition">
              <i class="fas fa-paper-plane mr-2"></i>Send Proposal
            </button>
          </div>
        </div>

        <!-- Background decorations -->
        <div class="absolute -bottom-4 -left-4 w-48 h-48 bg-gradient-to-r from-[#e6f7f0] to-[#f5f3e7] rounded-2xl -z-10"></div>
        <div class="absolute -top-4 -right-4 w-48 h-48 bg-gradient-to-r from-[#e6f0f7] to-[#e6f7f0] rounded-2xl -z-10"></div>
      </div>

      ${recsHtml}

      <div class="flex justify-center gap-4 mt-8">
        <button onclick="goToStep(2)" class="px-6 py-2.5 bg-white border-2 border-gray-200 text-gray-600 font-semibold rounded-xl text-sm hover:border-gray-300 transition">
          <i class="fas fa-arrow-left mr-2"></i>Edit Services
        </button>
        <button onclick="startOver()" class="px-6 py-2.5 text-gray-400 font-medium text-sm hover:text-gray-600 transition">
          Start Over
        </button>
      </div>
    </div>`;
}

// ─── Modal & reset ───────────────────────────────────────────────────────
function showSuccessModal() {
  const modal = document.getElementById("success-modal");
  modal.classList.remove("hidden");
  const content = modal.querySelector(".modal-content");
  content.style.transform = "scale(0.95)";
  content.style.opacity = "0";
  requestAnimationFrame(() => {
    content.style.transition = "transform 0.3s ease, opacity 0.3s ease";
    content.style.transform = "scale(1)";
    content.style.opacity = "1";
  });
}

function closeModal() {
  document.getElementById("success-modal").classList.add("hidden");
}

function startOver() {
  state.step = 1;
  state.proposal = null;
  state.enabledItems = [];
  state.imageData = null;
  render();
  // Reset file input
  const input = document.getElementById("image-input");
  if (input) input.value = "";
  const placeholder = document.getElementById("upload-placeholder");
  const preview = document.getElementById("upload-preview");
  if (placeholder) placeholder.classList.remove("hidden");
  if (preview) preview.classList.add("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─── Init ────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  render();
  setupImageUpload();

  // Allow Enter key on address input
  document.getElementById("address-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") generateEstimate();
  });
});
