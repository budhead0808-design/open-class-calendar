/**
 * 公開授課行事曆與管理系統 - app.js
 * 包含：手繪風格介面、前後台獨立分工、自訂網站標題與自訂後台密碼修改
 */

// ==========================================================================
// 1. Data Store & Settings Management
// ==========================================================================
class DataStore {
  constructor() {
    this.storageDataKey = 'OPEN_CLASS_CALENDAR_DATA_V3';
    this.storageSettingsKey = 'OPEN_CLASS_SETTINGS_V2';
    this.storageSnapshotsKey = 'OPEN_CLASS_DAILY_SNAPSHOTS_V1';
    this.storageGasUrlKey = 'OPEN_CLASS_GAS_URL';
    this.currentPortal = 'frontend'; // 'frontend' | 'backend'
    this.adminSubView = 'dashboard';
    this.currentDate = new Date();

    const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbw3PWExAU3_-6qC4EEW9dJWgQdVehqlr3Y2Qt3kpEtt97Nb211TkycRj1dfIB0K6B7W/exec';
    const storedGasUrl = localStorage.getItem(this.storageGasUrlKey);
    this.gasApiUrl = (storedGasUrl && storedGasUrl.startsWith('http')) ? storedGasUrl : DEFAULT_GAS_URL;
    localStorage.setItem(this.storageGasUrlKey, this.gasApiUrl);

    this.openClasses = this.loadData();
    this.settings = this.loadSettings();
    this.triggerDailySnapshot();
    
    // 初始化完成後自動與雲端試算表同步
    setTimeout(() => {
      this.updateCloudStatusBadge();
      if (this.gasApiUrl) this.syncFromCloud();
    }, 100);
  }

  loadData() {
    const keysToTry = ['OPEN_CLASS_CALENDAR_DATA_V3', 'OPEN_CLASS_CALENDAR_DATA_V2', 'OPEN_CLASS_CALENDAR_DATA_V1'];
    for (const key of keysToTry) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const hasLuo = parsed.some(item => item.teacher && item.teacher.includes('羅任鎗'));
            if (!hasLuo) {
              const luoEntry = DEFAULT_OPEN_CLASSES.find(i => i.teacher === '羅任鎗');
              if (luoEntry) parsed.push(luoEntry);
            }
            this.saveData(parsed);
            return parsed;
          }
        } catch (e) { console.error('Data migration error', e); }
      }
    }
    this.saveData(DEFAULT_OPEN_CLASSES);
    return [...DEFAULT_OPEN_CLASSES];
  }

  saveData(data = this.openClasses) {
    this.openClasses = data;
    localStorage.setItem(this.storageDataKey, JSON.stringify(data));
    this.triggerDailySnapshot();
  }

  loadSettings() {
    const fixedTitle = "115學年度新北市中山國民小學公開授課行事曆";
    const fixedSubtitle = "115學年度教師公開授課與觀課報名網";

    let savedPass = 'admin';

    // 優先讀取已修改的最新密碼 (V2)
    const rawV2 = localStorage.getItem('OPEN_CLASS_SETTINGS_V2');
    if (rawV2) {
      try {
        const parsed = JSON.parse(rawV2);
        if (parsed && parsed.adminPassword) {
          savedPass = parsed.adminPassword;
        }
      } catch (e) { console.error('Settings read error', e); }
    } else {
      const rawV1 = localStorage.getItem('OPEN_CLASS_SETTINGS_V1');
      if (rawV1) {
        try {
          const parsed = JSON.parse(rawV1);
          if (parsed && parsed.adminPassword) {
            savedPass = parsed.adminPassword;
          }
        } catch (e) {}
      }
    }

    const lockedSettings = {
      siteTitle: fixedTitle,
      siteSubtitle: fixedSubtitle,
      adminPassword: savedPass
    };
    this.saveSettings(lockedSettings);
    return lockedSettings;
  }

  saveSettings(newSettings = this.settings) {
    this.settings = newSettings;
    localStorage.setItem(this.storageSettingsKey, JSON.stringify(newSettings));
    this.triggerDailySnapshot();
  }

  getSnapshots() {
    const raw = localStorage.getItem(this.storageSnapshotsKey);
    if (raw) {
      try { return JSON.parse(raw); } catch (e) { console.error('Snapshot read error', e); }
    }
    return [];
  }

  triggerDailySnapshot() {
    if (!this.openClasses || !this.settings) return;
    const snapshots = this.getSnapshots();
    const todayStr = new Date().toISOString().split('T')[0];
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    const newSnapshot = {
      date: todayStr,
      time: timeStr,
      count: this.openClasses ? this.openClasses.length : 0,
      title: this.settings ? this.settings.siteTitle : '',
      openClasses: this.openClasses,
      settings: this.settings
    };

    const idx = snapshots.findIndex(s => s.date === todayStr);
    if (idx !== -1) {
      snapshots[idx] = newSnapshot;
    } else {
      snapshots.unshift(newSnapshot);
    }

    const trimmed = snapshots.slice(0, 30);
    localStorage.setItem(this.storageSnapshotsKey, JSON.stringify(trimmed));
  }

  getAll() {
    return this.openClasses;
  }

  getFrontendList(filters = {}) {
    let result = this.openClasses.filter(item => item.status === '已公告');

    if (filters.subject && filters.subject !== 'all') {
      result = result.filter(item => item.subject === filters.subject);
    }
    if (filters.openType && filters.openType !== 'all') {
      result = result.filter(item => item.openType === filters.openType);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(item =>
        item.teacher.toLowerCase().includes(q) ||
        item.unit.toLowerCase().includes(q) ||
        item.className.toLowerCase().includes(q) ||
        (item.location && item.location.toLowerCase().includes(q))
      );
    }
    return result;
  }

  addEntry(entry) {
    const newRecord = {
      id: 'OC-' + Date.now().toString().slice(-6),
      sessionId: this.openClasses.length + 1,
      createdDate: new Date().toISOString().split('T')[0],
      registeredObservers: [],
      ...entry
    };
    this.openClasses.push(newRecord);
    this.saveData();
    this.pushToCloud('addOpenClass', newRecord);
    return newRecord;
  }

  updateEntry(id, updatedFields) {
    const idx = this.openClasses.findIndex(item => item.id === id);
    if (idx !== -1) {
      this.openClasses[idx] = { ...this.openClasses[idx], ...updatedFields };
      this.saveData();
      this.pushToCloud('updateOpenClass', updatedFields, { id: id });
    }
  }

  registerObserver(id, observerData) {
    const target = this.openClasses.find(item => item.id === id);
    if (target) {
      if (!target.registeredObservers) target.registeredObservers = [];
      target.registeredObservers.push(observerData);
      this.saveData();
      this.pushToCloud('registerObserver', null, { id: id, observer: observerData });
    }
  }

  batchUpdateStatus(ids, newStatus) {
    this.openClasses.forEach(item => {
      if (ids.includes(item.id)) item.status = newStatus;
    });
    this.saveData();
    this.pushToCloud('batchUpdateStatus', null, { ids: ids, status: newStatus });
  }

  setGasUrl(url) {
    this.gasApiUrl = (url || '').trim();
    localStorage.setItem(this.storageGasUrlKey, this.gasApiUrl);
    this.updateCloudStatusBadge();
  }

  updateCloudStatusBadge(state = null, text = null) {
    const badge = document.getElementById('cloudStatusBadge');
    const badgeText = document.getElementById('cloudStatusText');
    const connBadge = document.getElementById('cloudConnBadge');

    let currentText = text;
    let iconClass = 'fa-solid fa-cloud';
    let bg = '#f1f5f9';
    let color = '#64748b';

    if (state === 'syncing') {
      currentText = text || '雲端同步中...';
      iconClass = 'fa-solid fa-arrows-rotate fa-spin';
      bg = '#fef9c3';
      color = '#854d0e';
    } else if (this.gasApiUrl) {
      currentText = text || '雲端同步已連線';
      iconClass = 'fa-solid fa-cloud-arrow-up';
      bg = '#dcfce7';
      color = '#15803d';
    } else {
      currentText = '本機離線模式';
      iconClass = 'fa-solid fa-cloud';
      bg = '#f1f5f9';
      color = '#64748b';
    }

    if (badge) {
      badge.style.background = bg;
      badge.style.color = color;
      badge.innerHTML = `<i class="${iconClass}"></i> <span id="cloudStatusText">${currentText}</span>`;
    }

    if (connBadge) {
      if (this.gasApiUrl) {
        connBadge.className = 'badge badge-approved';
        connBadge.style.background = '#dcfce7';
        connBadge.style.color = '#15803d';
        connBadge.textContent = '🟢 已連線至 Google 試算表';
      } else {
        connBadge.className = 'badge';
        connBadge.style.background = '#e2e8f0';
        connBadge.style.color = '#475569';
        connBadge.textContent = '未連線 (本機模式)';
      }
    }
  }

  async syncFromCloud() {
    if (!this.gasApiUrl) {
      this.updateCloudStatusBadge();
      return false;
    }

    try {
      this.updateCloudStatusBadge('syncing', '從雲端載入中...');
      const res = await fetch(this.gasApiUrl, { cache: 'no-store' });
      const json = await res.json();

      if (json && json.status === 'success') {
        if (Array.isArray(json.openClasses) && json.openClasses.length > 0) {
          this.openClasses = json.openClasses;
          localStorage.setItem(this.storageDataKey, JSON.stringify(this.openClasses));
        } else if (Array.isArray(json.openClasses) && json.openClasses.length === 0 && this.openClasses.length > 0) {
          // 若雲端試算表剛建立還是空的，自動將現有資料同步初始化至雲端試算表！
          this.pushToCloud('syncAll', null, { openClasses: this.openClasses, settings: this.settings });
        }

        if (json.settings && json.settings.siteTitle) {
          this.settings = { ...this.settings, ...json.settings };
          localStorage.setItem(this.storageSettingsKey, JSON.stringify(this.settings));
        }
        this.updateCloudStatusBadge();
        applySystemSettings();
        renderCurrentPortal();
        return true;
      }
    } catch (err) {
      console.warn('Cloud sync error, fallback to local storage:', err);
      this.updateCloudStatusBadge('error', '雲端連線失敗 (使用本機快取)');
    }
    return false;
  }

  async pushToCloud(action, data, extra = {}) {
    if (!this.gasApiUrl) return;

    try {
      this.updateCloudStatusBadge('syncing', '正在同步至雲端...');
      const payload = { action, data, ...extra };
      await fetch(this.gasApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      this.updateCloudStatusBadge();
    } catch (err) {
      console.error('Push to cloud error:', err);
      this.updateCloudStatusBadge('error', '雲端同步異常');
    }
  }
}

const store = new DataStore();

// ==========================================================================
// 2. Controller & Initialization
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  applySystemSettings();
  initPortalSwitcher();
  initFrontendFilters();
  initBackendTabs();
  initModals();
  initCalendarControls();
  initExportEngine();
  initSettingsForm();

  renderCurrentPortal();
});

// 套用標題與設定至全站
function applySystemSettings() {
  const { siteTitle, siteSubtitle } = store.settings;
  document.title = `${siteTitle} | 公開授課與教務彙整系統`;

  const displayTitle = document.getElementById('displaySiteTitle');
  const displaySubtitle = document.getElementById('displaySiteSubtitle');
  const displayAdminTitle = document.getElementById('displayAdminSiteTitle');
  const printReportTitle = document.getElementById('printReportTitle');

  if (displayTitle) displayTitle.textContent = siteTitle;
  if (displaySubtitle) displaySubtitle.textContent = siteSubtitle || "115學年度教師公開授課與觀課報名網";
  if (displayAdminTitle) displayAdminTitle.textContent = `${siteTitle} - 教務處管理後台`;
  if (printReportTitle) printReportTitle.textContent = `${siteTitle} 彙整表`;

  // 填入設定表單
  const settingTitleInput = document.getElementById('settingSiteTitle');
  const settingSubtitleInput = document.getElementById('settingSiteSubtitle');
  if (settingTitleInput) settingTitleInput.value = siteTitle;
  if (settingSubtitleInput) settingSubtitleInput.value = siteSubtitle || "";
}

// 前後台 Portal 切換
function initPortalSwitcher() {
  const frontendHeader = document.getElementById('frontendHeader');
  const backendHeader = document.getElementById('backendHeader');
  const frontendPortal = document.getElementById('frontendPortal');
  const backendPortal = document.getElementById('backendPortal');
  const bannerNotice = document.getElementById('bannerNotice');

  const switchToBackendBtn = document.getElementById('switchToBackendBtn');
  const switchToFrontendBtn = document.getElementById('switchToFrontendBtn');
  const adminLoginModal = document.getElementById('adminLoginModal');

  switchToBackendBtn.addEventListener('click', () => {
    document.getElementById('adminPasswordInput').value = '';
    adminLoginModal.classList.add('active');
    setTimeout(() => document.getElementById('adminPasswordInput').focus(), 150);
  });

  document.getElementById('closeAdminLoginModalBtn').addEventListener('click', () => {
    adminLoginModal.classList.remove('active');
  });
  document.getElementById('cancelAdminLoginBtn').addEventListener('click', () => {
    adminLoginModal.classList.remove('active');
  });

  // 驗證後台密碼 (比對 store.settings.adminPassword)
  const doAdminLogin = () => {
    const inputPass = document.getElementById('adminPasswordInput').value;
    const currentPass = store.settings.adminPassword || 'admin';

    if (inputPass === currentPass) {
      adminLoginModal.classList.remove('active');
      setPortal('backend');
    } else {
      alert('密碼錯誤！請重新輸入後台登入密碼。');
    }
  };

  document.getElementById('confirmAdminLoginBtn').addEventListener('click', doAdminLogin);
  document.getElementById('adminPasswordInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doAdminLogin();
    }
  });

  // 獨立修改密碼彈窗處理
  const changePasswordModal = document.getElementById('changePasswordModal');
  const showChangePassFromLoginBtn = document.getElementById('showChangePassFromLoginBtn');
  const backendChangePassBtn = document.getElementById('backendChangePassBtn');
  const closeChangePassModalBtn = document.getElementById('closeChangePassModalBtn');
  const cancelChangePassBtn = document.getElementById('cancelChangePassBtn');
  const standaloneChangePassForm = document.getElementById('standaloneChangePassForm');

  const openChangePassModal = () => {
    if (adminLoginModal) adminLoginModal.classList.remove('active');
    if (standaloneChangePassForm) standaloneChangePassForm.reset();
    if (changePasswordModal) changePasswordModal.classList.add('active');
    setTimeout(() => {
      const oldInput = document.getElementById('pwdOldInput');
      if (oldInput) oldInput.focus();
    }, 150);
  };

  if (showChangePassFromLoginBtn) showChangePassFromLoginBtn.addEventListener('click', openChangePassModal);
  if (backendChangePassBtn) backendChangePassBtn.addEventListener('click', openChangePassModal);
  if (closeChangePassModalBtn) closeChangePassModalBtn.addEventListener('click', () => changePasswordModal.classList.remove('active'));
  if (cancelChangePassBtn) cancelChangePassBtn.addEventListener('click', () => changePasswordModal.classList.remove('active'));

  if (standaloneChangePassForm) {
    standaloneChangePassForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const oldPass = document.getElementById('pwdOldInput').value;
      const newPass = document.getElementById('pwdNewInput').value;
      const confirmPass = document.getElementById('pwdConfirmInput').value;
      const currentPass = store.settings.adminPassword || 'admin';

      if (oldPass !== currentPass) {
        return alert('⚠️ 目前舊密碼輸入錯誤，請重新確認！');
      }
      if (newPass.length < 3) {
        return alert('⚠️ 新密碼長度過短，請至少設定 3 個字元！');
      }
      if (newPass !== confirmPass) {
        return alert('⚠️ 兩次輸入的新密碼不相符，請再次檢查！');
      }

      store.settings.adminPassword = newPass;
      store.saveSettings();
      try { localStorage.removeItem('OPEN_CLASS_SETTINGS_V1'); } catch (err) {}
      store.pushToCloud('updatePassword', null, { password: newPass });

      alert(`✅ 教務處管理密碼已成功變更！\n新密碼為：${newPass}\n下次登入請使用新密碼。`);
      changePasswordModal.classList.remove('active');
    });
  }

  switchToFrontendBtn.addEventListener('click', () => {
    setPortal('frontend');
  });

  function setPortal(portal) {
    store.currentPortal = portal;

    if (portal === 'backend') {
      frontendHeader.classList.add('hidden');
      backendHeader.classList.remove('hidden');
      frontendPortal.classList.add('hidden');
      backendPortal.classList.remove('hidden');
      bannerNotice.style.display = 'none';
      document.body.className = 'mode-backend';
    } else {
      backendHeader.classList.add('hidden');
      frontendHeader.classList.remove('hidden');
      backendPortal.classList.add('hidden');
      frontendPortal.classList.remove('hidden');
      bannerNotice.style.display = 'block';
      document.body.className = 'mode-frontend';
    }

    renderCurrentPortal();
  }
}

function renderCurrentPortal() {
  if (store.currentPortal === 'frontend') {
    renderFrontendPortal();
  } else {
    renderBackendPortal();
  }
}

// ==========================================================================
// 3. 前台 (Frontend Portal)
// ==========================================================================
function initFrontendFilters() {
  const searchInput = document.getElementById('frontendSearchInput');
  const subjectFilter = document.getElementById('frontendSubjectFilter');
  const openTypeFilter = document.getElementById('frontendOpenTypeFilter');
  const resetBtn = document.getElementById('frontendResetBtn');

  [searchInput, subjectFilter, openTypeFilter].forEach(el => {
    el.addEventListener('change', renderFrontendPortal);
  });
  searchInput.addEventListener('input', renderFrontendPortal);

  resetBtn.addEventListener('click', () => {
    searchInput.value = '';
    subjectFilter.value = 'all';
    openTypeFilter.value = 'all';
    renderFrontendPortal();
  });

  document.getElementById('frontendProcessBtn').addEventListener('click', () => {
    document.querySelector('.frontend-process-section').scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('frontendRegisterBtn').addEventListener('click', () => {
    openFormModal();
  });
}

function renderFrontendPortal() {
  const list = store.getFrontendList({
    search: document.getElementById('frontendSearchInput').value,
    subject: document.getElementById('frontendSubjectFilter').value,
    openType: document.getElementById('frontendOpenTypeFilter').value
  });

  document.getElementById('frontendResultCount').textContent = `共 ${list.length} 場次已公告公開授課`;

  const tbody = document.getElementById('frontendTableBody');
  tbody.innerHTML = '';

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-muted">目前無符合條件之已公告公開授課場次。</td></tr>`;
  } else {
    list.forEach((item, idx) => {
      const regCount = item.registeredObservers ? item.registeredObservers.length : 0;
      const maxObs = item.maxObservers || 10;
      const available = Math.max(0, maxObs - regCount);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${item.sessionId || idx + 1}</strong></td>
        <td><div>${item.date}</div><small class="text-muted">${item.period}</small></td>
        <td><span class="badge badge-draft">${item.className} 班</span></td>
        <td><strong>${item.teacher}</strong></td>
        <td><span class="badge badge-approved">${item.subject}</span></td>
        <td>${item.unit}</td>
        <td>${item.location || '原班教室'}</td>
        <td><span class="badge badge-type-${getOpenTypeBadgeClass(item.openType)}">${item.openType}</span></td>
        <td>
          <small class="${available > 0 ? 'text-success' : 'text-danger'}">
            已報名 ${regCount}/${maxObs}人 (剩 ${available} 席)
          </small>
        </td>
        <td>
          <button class="btn btn-sm btn-sketch-primary" onclick="openDetailModal('${item.id}')">
            <i class="fa-solid fa-eye"></i> 檢視 / 報名
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  renderFrontendTimeline();
}

function renderFrontendTimeline() {
  const container = document.getElementById('frontendTimeline');
  if (!container) return;
  container.innerHTML = '';

  PROCESS_STEPS.forEach(stepObj => {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.innerHTML = `
      <div class="timeline-badge">${stepObj.step}</div>
      <div class="timeline-content">
        <div class="timeline-header">
          <h4 class="timeline-title">${stepObj.title}</h4>
          <span class="badge badge-approved">${stepObj.tag}</span>
        </div>
        <p style="white-space: pre-line; font-size: 0.85rem; color: var(--text-muted);">${stepObj.desc}</p>
      </div>
    `;
    container.appendChild(item);
  });
}

// ==========================================================================
// 4. 後台 (Backend Portal) & 密碼/標題設定 (Settings)
// ==========================================================================
function initBackendTabs() {
  const tabs = document.querySelectorAll('[data-adminview]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      store.adminSubView = tab.dataset.adminview;
      document.querySelectorAll('.admin-subview').forEach(v => v.classList.add('hidden'));

      const targetView = document.getElementById('adminSub' + capitalize(store.adminSubView));
      if (targetView) targetView.classList.remove('hidden');

      renderBackendPortal();
    });
  });

  document.getElementById('backendNewBtn').addEventListener('click', () => {
    openFormModal();
  });

  document.getElementById('selectAllPendingCheck').addEventListener('change', (e) => {
    document.querySelectorAll('.admin-pending-check').forEach(cb => cb.checked = e.target.checked);
  });

  document.getElementById('batchApproveBtn').addEventListener('click', () => {
    const selected = getSelectedPendingIds();
    if (selected.length === 0) return alert('請先勾選欲核准的公開授課案件');
    store.batchUpdateStatus(selected, '已核准');
    alert(`成功核准 ${selected.length} 筆案件！`);
    renderBackendPortal();
  });

  document.getElementById('batchPublishBtn').addEventListener('click', () => {
    const selected = getSelectedPendingIds();
    if (selected.length === 0) return alert('請先勾選欲公告發布的公開授課案件');
    store.batchUpdateStatus(selected, '已公告');
    alert(`成功公告 ${selected.length} 筆案件至全校公開授課行事曆！`);
    renderBackendPortal();
  });
}

// 標題與密碼修改表單處理
function initSettingsForm() {
  const form = document.getElementById('systemSettingsForm');
  if (!form) return;

  // Google 試算表雲端同步設定
  const gasInput = document.getElementById('settingGasUrl');
  if (gasInput) {
    gasInput.value = store.gasApiUrl;
  }

  const testCloudBtn = document.getElementById('testCloudConnBtn');
  if (testCloudBtn) {
    testCloudBtn.addEventListener('click', async () => {
      const url = gasInput ? gasInput.value.trim() : '';
      if (!url) {
        return alert('請先填入 Google Apps Script 網頁應用程式網址！');
      }
      store.setGasUrl(url);
      testCloudBtn.disabled = true;
      testCloudBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 連線測試中...`;

      const success = await store.syncFromCloud();
      testCloudBtn.disabled = false;
      testCloudBtn.innerHTML = `<i class="fa-solid fa-link"></i> 連線測試並載入雲端資料`;

      if (success) {
        alert('🎉 連線成功！已成功從 Google 試算表載入最新全校公開授課資料與密碼設定！');
      } else {
        alert('⚠️ 連線測試失敗，請確認：\n1. Google Apps Script 部署作業是否已設為「任何人 (Anyone)」皆可存取。\n2. 網址結尾是否為 /exec。');
      }
    });
  }

  const uploadAllBtn = document.getElementById('uploadAllToCloudBtn');
  if (uploadAllBtn) {
    uploadAllBtn.addEventListener('click', async () => {
      const url = gasInput ? gasInput.value.trim() : '';
      if (!url) {
        return alert('請先填入 Google Apps Script 網頁應用程式網址！');
      }
      store.setGasUrl(url);

      if (!confirm(`確定要將目前的 ${store.openClasses.length} 筆公開授課與學校設定全數上傳初始化至 Google 試算表嗎？`)) {
        return;
      }

      uploadAllBtn.disabled = true;
      uploadAllBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 上傳中...`;
      try {
        await store.pushToCloud('syncAll', null, { openClasses: store.openClasses, settings: store.settings });
        uploadAllBtn.disabled = false;
        uploadAllBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> 將目前現有資料上傳至雲端`;
        alert('🎉 資料已全數成功上傳至 Google 試算表！\n請打開您的 Google 試算表檢查，現在全校所有電腦與手機都已即時連線！');
      } catch (err) {
        uploadAllBtn.disabled = false;
        uploadAllBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> 將目前現有資料上傳至雲端`;
        alert('上傳失敗：' + err.message);
      }
    });
  }

  const copyGasBtn = document.getElementById('copyGasCodeBtn');
  if (copyGasBtn) {
    copyGasBtn.addEventListener('click', () => {
      fetch('google-apps-script.js')
        .then(res => res.text())
        .then(code => {
          navigator.clipboard.writeText(code).then(() => {
            alert('📋 Google Apps Script 完整程式碼已複製至剪貼簿！\n請前往 Google 試算表「擴充功能」->「Apps Script」貼上並部署即可！');
          }).catch(() => {
            alert('複製失敗，請直接在專案資料夾打開 google-apps-script.js 複製。');
          });
        })
        .catch(() => {
          alert('請直接在專案資料夾打開 google-apps-script.js 複製。');
        });
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const newTitle = document.getElementById('settingSiteTitle').value.trim();
    const newSubtitle = document.getElementById('settingSiteSubtitle').value.trim();
    const currentPassInput = document.getElementById('settingCurrentPassword').value;
    const newPassInput = document.getElementById('settingNewPassword').value;
    const confirmPassInput = document.getElementById('settingConfirmPassword').value;

    if (!newTitle) {
      return alert('網站標題不能為空！');
    }

    let passwordChanged = false;

    // 若填寫了新密碼，進行驗證與修改
    if (newPassInput || currentPassInput) {
      if (currentPassInput !== store.settings.adminPassword) {
        return alert('目前的舊密碼輸入錯誤，無法修改密碼！');
      }
      if (newPassInput !== confirmPassInput) {
        return alert('兩次輸入的新密碼不一致，請再次檢查！');
      }
      if (newPassInput.length < 3) {
        return alert('新密碼長度太短，請至少設定 3 個字元！');
      }
      passwordChanged = true;
    }

    // 儲存設定
    const updatedSettings = {
      siteTitle: newTitle,
      siteSubtitle: newSubtitle,
      adminPassword: passwordChanged ? newPassInput : store.settings.adminPassword
    };

    store.saveSettings(updatedSettings);
    applySystemSettings();

    // 清空密碼欄位
    document.getElementById('settingCurrentPassword').value = '';
    document.getElementById('settingNewPassword').value = '';
    document.getElementById('settingConfirmPassword').value = '';

    alert('✅ 系統設定已成功儲存！' + (passwordChanged ? '\n後台登入密碼已成功更新！' : ''));
  });

  // JSON 全庫備份與還原
  const exportBackupBtn = document.getElementById('exportBackupJsonBtn');
  const importBackupBtn = document.getElementById('importBackupJsonBtn');
  const importFileInput = document.getElementById('importBackupFileInput');

  if (exportBackupBtn) {
    exportBackupBtn.addEventListener('click', () => {
      const backupData = {
        openClasses: store.openClasses,
        settings: store.settings,
        exportDate: new Date().toISOString()
      };
      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${store.settings.siteTitle || '公開授課'}_全庫備份_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }

  if (importBackupBtn && importFileInput) {
    importBackupBtn.addEventListener('click', () => {
      importFileInput.click();
    });

    importFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const imported = JSON.parse(event.target.result);
          if (imported.openClasses && Array.isArray(imported.openClasses)) {
            store.saveData(imported.openClasses);
            store.openClasses = imported.openClasses;

            if (imported.settings && imported.settings.siteTitle) {
              store.saveSettings(imported.settings);
            }

            applySystemSettings();
            renderCurrentPortal();
            alert('✅ 成功匯入還原全庫備份資料！所有公開授課場次與學校標題已完全復原。');
          } else {
            alert('⚠️ 備份檔案格式不正確，請確認上傳有效的 JSON 備份檔。');
          }
        } catch (err) {
          alert('⚠️ 解析備份檔案失敗：' + err.message);
        }
      };
      reader.readAsText(file);
    });
  }
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getSelectedPendingIds() {
  return Array.from(document.querySelectorAll('.admin-pending-check:checked')).map(cb => cb.value);
}

function renderBackendPortal() {
  updatePendingBadgeCount();

  if (store.adminSubView === 'dashboard') {
    renderAdminDashboard();
  } else if (store.adminSubView === 'month') {
    renderAdminMonthCalendar();
  } else if (store.adminSubView === 'week') {
    renderAdminWeekSchedule();
  } else if (store.adminSubView === 'master') {
    renderAdminMasterTable();
  } else if (store.adminSubView === 'settings') {
    renderAutoBackupTable();
  }
}

function renderAutoBackupTable() {
  const tbody = document.getElementById('autoBackupTableBody');
  if (!tbody) return;

  const snapshots = store.getSnapshots();
  tbody.innerHTML = '';

  if (snapshots.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-2 text-muted">目前尚無每日自動備份快照。</td></tr>`;
    return;
  }

  snapshots.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${s.date}</strong> <small class="text-muted">${s.time || ''}</small></td>
      <td><span class="badge badge-approved">${s.count} 筆授課</span></td>
      <td><small>${s.title || '-'}</small></td>
      <td>
        <button class="btn btn-sm btn-sketch-success" onclick="downloadSnapshotJson('${s.date}')">
          <i class="fa-solid fa-download"></i> 下載
        </button>
        <button class="btn btn-sm btn-sketch-outline" onclick="restoreSnapshotJson('${s.date}')">
          <i class="fa-solid fa-rotate-left"></i> 復原
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const autoCheckbox = document.getElementById('autoDownloadDailyCheckbox');
  if (autoCheckbox) {
    autoCheckbox.checked = !!store.settings.autoDownloadDaily;
    autoCheckbox.onchange = (e) => {
      store.settings.autoDownloadDaily = e.target.checked;
      store.saveSettings();
    };
  }
}

function downloadSnapshotJson(dateStr) {
  const snapshots = store.getSnapshots();
  const target = snapshots.find(s => s.date === dateStr);
  if (!target) return alert('找不到該日期的快照檔！');

  const jsonStr = JSON.stringify(target, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${target.title || '公開授課'}_每日快照備份_${dateStr}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function restoreSnapshotJson(dateStr) {
  const snapshots = store.getSnapshots();
  const target = snapshots.find(s => s.date === dateStr);
  if (!target) return alert('找不到該日期的快照檔！');

  if (confirm(`確定要將系統狀態一鍵復原至【${dateStr}】的每日快照備份嗎？\n復原後將還原該日的所有公開授課與學校標題。`)) {
    if (target.openClasses) {
      store.saveData(target.openClasses);
    }
    if (target.settings) {
      store.saveSettings(target.settings);
    }
    applySystemSettings();
    renderCurrentPortal();
    alert(`✅ 已成功將系統一鍵復原至【${dateStr}】的備份狀態！`);
  }
}

function updatePendingBadgeCount() {
  const pendingCount = store.getAll().filter(i => i.status === '待審核').length;
  const badge = document.getElementById('pendingReviewCount');
  if (badge) {
    badge.textContent = pendingCount;
    badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
  }
}

function renderAdminDashboard() {
  const all = store.getAll();
  const published = all.filter(i => i.status === '已公告').length;
  const pending = all.filter(i => i.status === '待審核').length;
  const approved = all.filter(i => i.status === '已核准').length;
  const totalRegs = all.reduce((sum, i) => sum + (i.registeredObservers ? i.registeredObservers.length : 0), 0);

  document.getElementById('statPublishedCount').textContent = published;
  document.getElementById('statPendingCount').textContent = pending;
  document.getElementById('statApprovedCount').textContent = approved;
  document.getElementById('statRegistrationTotal').textContent = totalRegs;

  const tbody = document.getElementById('adminPendingTableBody');
  tbody.innerHTML = '';

  const pendingList = all.filter(i => i.status === '待審核' || i.status === '草稿' || i.status === '已核准');

  if (pendingList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-muted">尚無待審核之公開授課登記案件。</td></tr>`;
    return;
  }

  pendingList.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="admin-pending-check" value="${item.id}"></td>
      <td><strong>${item.date}</strong><br><small class="text-muted">${item.period}</small></td>
      <td>${item.className} 班</td>
      <td><strong>${item.teacher}</strong></td>
      <td><span class="badge badge-approved">${item.subject}</span><br><small>${item.unit}</small></td>
      <td><span class="badge badge-type-${getOpenTypeBadgeClass(item.openType)}">${item.openType}</span></td>
      <td>${item.createdDate || '-'}</td>
      <td><span class="badge badge-${getStatusBadgeClass(item.status)}">${item.status}</span></td>
      <td>
        <button class="btn btn-sm btn-sketch-success" onclick="adminApproveItem('${item.id}')">核准</button>
        <button class="btn btn-sm btn-sketch-primary" onclick="adminPublishItem('${item.id}')">發布公告</button>
        <button class="btn btn-sm btn-sketch-outline text-danger" onclick="adminReturnItem('${item.id}')">退回</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function adminApproveItem(id) {
  store.updateEntry(id, { status: '已核准' });
  alert('已核准該筆公開授課申請！');
  renderBackendPortal();
}

function adminPublishItem(id) {
  store.updateEntry(id, { status: '已公告' });
  alert('已發布公告至全校行事曆！');
  renderBackendPortal();
}

function adminReturnItem(id) {
  const comment = prompt('請輸入退回修正原因：');
  if (comment !== null) {
    store.updateEntry(id, { status: '需修正', revisionComment: comment });
    alert('已退回給教師修正。');
    renderBackendPortal();
  }
}

function renderAdminMasterTable() {
  const tbody = document.getElementById('adminMasterTableBody');
  tbody.innerHTML = '';

  const all = store.getAll();
  all.forEach((item, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${item.sessionId || idx + 1}</strong></td>
      <td><div>${item.date}</div><small class="text-muted">${item.period}</small></td>
      <td>${item.className} 班</td>
      <td><strong>${item.teacher}</strong></td>
      <td><span class="badge badge-approved">${item.subject}</span></td>
      <td>${item.unit}</td>
      <td>${item.prepHost || '-'}</td>
      <td><small>${(item.coPrepGroup || '-').replace(/\n/g, ' ')}</small></td>
      <td>${item.postPrepHost || '-'}</td>
      <td><small>${(item.observationGroup || '-').replace(/\n/g, ' ')}</small></td>
      <td><span class="badge badge-type-${getOpenTypeBadgeClass(item.openType)}">${item.openType}</span></td>
      <td><span class="badge badge-${getStatusBadgeClass(item.status)}">${item.status}</span></td>
      <td>
        <button class="btn btn-sm btn-sketch-outline" onclick="openFormModal('${item.id}')"><i class="fa-solid fa-pen"></i> 編輯</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================================================
// 5. Calendar Render Engine
// ==========================================================================
function initCalendarControls() {
  document.getElementById('prevMonthBtn').addEventListener('click', () => {
    store.currentDate.setMonth(store.currentDate.getMonth() - 1);
    renderAdminMonthCalendar();
  });
  document.getElementById('nextMonthBtn').addEventListener('click', () => {
    store.currentDate.setMonth(store.currentDate.getMonth() + 1);
    renderAdminMonthCalendar();
  });
  document.getElementById('todayBtn').addEventListener('click', () => {
    store.currentDate = new Date();
    renderAdminMonthCalendar();
  });
}

function renderAdminMonthCalendar() {
  const title = document.getElementById('calendarMonthTitle');
  const grid = document.getElementById('calendarDaysGrid');
  grid.innerHTML = '';

  const year = store.currentDate.getFullYear();
  const month = store.currentDate.getMonth();
  title.textContent = `${year} 年 ${month + 1} 月`;

  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevMonthTotalDays = new Date(year, month, 0).getDate();
  const events = store.getAll();
  const today = new Date();

  for (let i = firstDay - 1; i >= 0; i--) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day-cell other-month';
    cell.innerHTML = `<span class="calendar-day-number">${prevMonthTotalDays - i}</span>`;
    grid.appendChild(cell);
  }

  for (let day = 1; day <= totalDays; day++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day-cell';

    if (today.getFullYear() === year && today.getMonth() === month && today.getDate() === day) {
      cell.classList.add('today');
    }

    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cell.innerHTML = `<span class="calendar-day-number">${day}</span><div class="day-events-wrapper"></div>`;

    const dayWrapper = cell.querySelector('.day-events-wrapper');
    const dayEvents = events.filter(e => e.date === dateStr);

    dayEvents.forEach(evt => {
      const pill = document.createElement('div');
      pill.className = `event-pill type-${getOpenTypeBadgeClass(evt.openType)}`;
      pill.innerHTML = `<strong>${evt.teacher}</strong> (${evt.subject})`;
      pill.addEventListener('click', () => openDetailModal(evt.id));
      dayWrapper.appendChild(pill);
    });

    grid.appendChild(cell);
  }
}

function renderAdminWeekSchedule() {
  const container = document.getElementById('weekGridContainer');
  container.innerHTML = '';

  const periods = ['第 1 節', '第 2 節', '第 3 節', '第 4 節', '第 5 節', '第 6 節', '第 7 節'];
  const weekdays = ['週一', '週二', '週三', '週四', '週五'];

  const headerRow = document.createElement('div');
  headerRow.className = 'week-header-row';
  headerRow.innerHTML = `<div>節次</div>` + weekdays.map(w => `<div>${w}</div>`).join('');
  container.appendChild(headerRow);

  const events = store.getAll();

  periods.forEach(p => {
    const row = document.createElement('div');
    row.className = 'week-period-row';
    row.innerHTML = `<div class="week-period-label">${p}</div>`;

    for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
      const cell = document.createElement('div');
      cell.className = 'week-cell';

      const matched = events.filter(e => e.period === p);
      matched.forEach(evt => {
        const item = document.createElement('div');
        item.className = `event-pill type-${getOpenTypeBadgeClass(evt.openType)}`;
        item.innerHTML = `<strong>${evt.teacher}</strong> | ${evt.className}班 ${evt.subject}`;
        item.addEventListener('click', () => openDetailModal(evt.id));
        cell.appendChild(item);
      });

      row.appendChild(cell);
    }
    container.appendChild(row);
  });
}

function getOpenTypeBadgeClass(type) {
  if (type === '校內') return 'school';
  if (type === '區級') return 'district';
  if (type === '市級') return 'city';
  return 'national';
}

function getStatusBadgeClass(status) {
  if (status === '草稿') return 'draft';
  if (status === '待審核') return 'pending';
  if (status === '已核准') return 'approved';
  if (status === '已公告') return 'published';
  return 'revision';
}

// ==========================================================================
// 6. Modals
// ==========================================================================
function initModals() {
  const openClassModal = document.getElementById('openClassModal');
  const detailModal = document.getElementById('detailModal');

  document.getElementById('closeFormModalBtn').addEventListener('click', () => openClassModal.classList.remove('active'));
  document.getElementById('closeDetailModalBtn').addEventListener('click', () => detailModal.classList.remove('active'));

  document.getElementById('openClassForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveOpenClassFromForm('待審核');
  });

  document.getElementById('saveDraftBtn').addEventListener('click', () => {
    saveOpenClassFromForm('草稿');
  });

  // 建議填列欄位展開/收合控制
  const toggleBtn = document.getElementById('toggleOptionalFieldsBtn');
  const collapseBtn = document.getElementById('collapseOptionalBtn');
  const optionalSection = document.getElementById('optionalFieldsSection');
  const optionalBtnText = document.getElementById('optionalBtnText');

  if (toggleBtn && optionalSection) {
    toggleBtn.addEventListener('click', () => {
      const isHidden = optionalSection.classList.contains('hidden');
      if (isHidden) {
        optionalSection.classList.remove('hidden');
        if (optionalBtnText) {
          optionalBtnText.innerHTML = `<i class="fa-solid fa-chevron-up"></i> 點此收合建議填列事項`;
        }
        optionalSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        optionalSection.classList.add('hidden');
        if (optionalBtnText) {
          optionalBtnText.innerHTML = `<i class="fa-solid fa-layer-group"></i> ＋ 點此填寫建議事項（備課/議課主持、共備名單、席次與教案連結）`;
        }
      }
    });
  }

  if (collapseBtn && optionalSection) {
    collapseBtn.addEventListener('click', () => {
      optionalSection.classList.add('hidden');
      if (optionalBtnText) {
        optionalBtnText.innerHTML = `<i class="fa-solid fa-layer-group"></i> ＋ 點此填寫建議事項（備課/議課主持、共備名單、席次與教案連結）`;
      }
    });
  }
}

function openFormModal(editId = null) {
  const modal = document.getElementById('openClassModal');
  const title = document.getElementById('modalFormTitle');
  const form = document.getElementById('openClassForm');
  const optionalSection = document.getElementById('optionalFieldsSection');
  const optionalBtnText = document.getElementById('optionalBtnText');
  form.reset();

  if (editId) {
    title.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> 編輯公開授課登記 (教育局 11 欄位)`;
    const target = store.getAll().find(i => i.id === editId);
    if (target) {
      document.getElementById('formEntryId').value = target.id;
      document.getElementById('formDate').value = target.date;
      document.getElementById('formPeriod').value = target.period;
      document.getElementById('formClassName').value = target.className;
      document.getElementById('formTeacher').value = target.teacher;
      document.getElementById('formSubject').value = target.subject;
      document.getElementById('formUnit').value = target.unit;
      document.getElementById('formOpenType').value = target.openType;
      document.getElementById('formLocation').value = target.location || '';
      document.getElementById('formPrepHost').value = target.prepHost || '';
      document.getElementById('formPostPrepHost').value = target.postPrepHost || '';
      document.getElementById('formCoPrepGroup').value = target.coPrepGroup || '';
      document.getElementById('formObservationGroup').value = target.observationGroup || '';
      document.getElementById('formMaxObservers').value = target.maxObservers || 10;
      document.getElementById('formLessonPlanUrl').value = target.lessonPlanUrl || '';
      document.getElementById('formNotes').value = target.notes || '';

      // 若編輯既有資料且已填寫過建議事項，自動展開方便檢視修改
      const hasOptional = !!(target.prepHost || target.postPrepHost || target.coPrepGroup || target.observationGroup || target.lessonPlanUrl || target.notes);
      if (optionalSection) {
        if (hasOptional) {
          optionalSection.classList.remove('hidden');
          if (optionalBtnText) optionalBtnText.innerHTML = `<i class="fa-solid fa-chevron-up"></i> 點此收合建議填列事項`;
        } else {
          optionalSection.classList.add('hidden');
          if (optionalBtnText) optionalBtnText.innerHTML = `<i class="fa-solid fa-layer-group"></i> ＋ 點此填寫建議事項（備課/議課主持、共備名單、席次與教案連結）`;
        }
      }
    }
  } else {
    title.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> 線上登記公開授課 (符合教育局 11 大欄位)`;
    document.getElementById('formEntryId').value = '';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('formDate').value = tomorrow.toISOString().split('T')[0];

    // 新增時預設收合建議填列事項，維持畫面清爽適合手機
    if (optionalSection) optionalSection.classList.add('hidden');
    if (optionalBtnText) optionalBtnText.innerHTML = `<i class="fa-solid fa-layer-group"></i> ＋ 點此填寫建議事項（備課/議課主持、共備名單、席次與教案連結）`;
  }

  modal.classList.add('active');
}

function saveOpenClassFromForm(targetStatus) {
  const id = document.getElementById('formEntryId').value;
  const entryData = {
    date: document.getElementById('formDate').value,
    period: document.getElementById('formPeriod').value,
    className: document.getElementById('formClassName').value,
    teacher: document.getElementById('formTeacher').value,
    subject: document.getElementById('formSubject').value,
    unit: document.getElementById('formUnit').value,
    openType: document.getElementById('formOpenType').value,
    location: document.getElementById('formLocation').value,
    prepHost: document.getElementById('formPrepHost').value,
    postPrepHost: document.getElementById('formPostPrepHost').value,
    coPrepGroup: document.getElementById('formCoPrepGroup').value,
    observationGroup: document.getElementById('formObservationGroup').value,
    maxObservers: parseInt(document.getElementById('formMaxObservers').value) || 10,
    lessonPlanUrl: document.getElementById('formLessonPlanUrl').value,
    notes: document.getElementById('formNotes').value,
    status: targetStatus
  };

  if (id) {
    store.updateEntry(id, entryData);
    alert('已成功更新公開授課資料！');
  } else {
    store.addEntry(entryData);
    alert(targetStatus === '草稿' ? '已成功儲存草稿！' : '已成功送出申請，等待教務處審核！');
  }

  document.getElementById('openClassModal').classList.remove('active');
  renderCurrentPortal();
}

function openDetailModal(id) {
  const target = store.getAll().find(i => i.id === id);
  if (!target) return;

  const modal = document.getElementById('detailModal');
  const body = document.getElementById('detailModalBody');

  const regCount = target.registeredObservers ? target.registeredObservers.length : 0;
  const maxObs = target.maxObservers || 10;
  const available = Math.max(0, maxObs - regCount);

  body.innerHTML = `
    <div style="margin-bottom: 1rem;">
      <span class="badge badge-type-${getOpenTypeBadgeClass(target.openType)}" style="font-size: 0.9rem;">${target.openType}公開授課</span>
      <span class="badge badge-${getStatusBadgeClass(target.status)}" style="font-size: 0.9rem;">${target.status}</span>
    </div>

    <h2 style="font-size: 1.3rem; margin-bottom: 1rem; color: var(--primary);">${target.subject} - ${target.unit}</h2>

    <div class="form-grid-2 sketch-card" style="background: #fefce8; padding: 1rem; margin-bottom: 1rem;">
      <div><strong>公開授課日期：</strong> ${target.date} (${target.period})</div>
      <div><strong>授課教師：</strong> ${target.teacher} (${target.className}班)</div>
      <div><strong>地點：</strong> ${target.location || '原班教室'}</div>
      <div><strong>觀課席次：</strong> 已報名 ${regCount} 人 / 上限 ${maxObs} 人 (剩餘 ${available} 席)</div>
    </div>

    <div style="font-size: 0.9rem; line-height: 1.8; margin-bottom: 1.25rem;">
      <div><strong>備課主持人：</strong> ${target.prepHost || '無'}</div>
      <div><strong>共同備課教師類群：</strong> ${(target.coPrepGroup || '無').replace(/\n/g, '、')}</div>
      <div><strong>議課主持人：</strong> ${target.postPrepHost || '無'}</div>
      <div><strong>觀課議課教師類群：</strong> ${(target.observationGroup || '無').replace(/\n/g, '、')}</div>
      ${target.lessonPlanUrl ? `<div style="margin-top:6px;"><a href="${target.lessonPlanUrl}" target="_blank" class="btn btn-sm btn-sketch-outline"><i class="fa-solid fa-link"></i> 查閱教學活動設計(教案)連結</a></div>` : ''}
      ${target.notes ? `<div style="margin-top:6px; color: var(--text-muted);"><strong>備註：</strong> ${target.notes}</div>` : ''}
    </div>

    <div style="border-top: 2px dashed var(--ink-border); padding-top: 1rem;">
      <h4 style="margin-bottom: 0.75rem;"><i class="fa-solid fa-user-plus"></i> 我要線上登記觀課</h4>
      ${available > 0 ? `
        <form id="registerObserverForm" onsubmit="handleRegisterObserver(event, '${target.id}')">
          <div class="form-grid-2">
            <div class="form-group">
              <label>觀課教師姓名 <span class="required-star">*</span></label>
              <input type="text" id="regObsName" class="form-control sketch-input" placeholder="您的姓名" required>
            </div>
            <div class="form-group">
              <label>服務學校 / 單位 <span class="required-star">*</span></label>
              <input type="text" id="regObsSchool" class="form-control sketch-input" value="本校" required>
            </div>
          </div>
          <button type="submit" class="btn btn-sketch-success w-100"><i class="fa-solid fa-circle-check"></i> 確認登記入席觀課</button>
        </form>
      ` : `<div style="background:#fffbeb; color:#b45309; padding:10px; border-radius:6px; border:2px solid var(--ink-border);">⚠️ 本場次觀課人數已額滿。</div>`}
    </div>

    ${regCount > 0 ? `
      <div style="margin-top: 1rem; font-size: 0.85rem;">
        <strong>已成功報名觀課教師：</strong>
        <ul style="padding-left: 1.25rem; margin-top: 4px; color: var(--text-muted);">
          ${target.registeredObservers.map(o => `<li>${o.name} (${o.school}) - <small>${o.time}</small></li>`).join('')}
        </ul>
      </div>
    ` : ''}
  `;

  modal.classList.add('active');
}

function handleRegisterObserver(e, id) {
  e.preventDefault();
  const name = document.getElementById('regObsName').value;
  const school = document.getElementById('regObsSchool').value;

  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  store.registerObserver(id, { name, school, time: timeStr });
  alert(`感謝 ${name} 老師！您已成功報名該場次公開授課。`);
  document.getElementById('detailModal').classList.remove('active');
  renderCurrentPortal();
}

// ==========================================================================
// 7. Export Engine
// ==========================================================================
function initExportEngine() {
  document.getElementById('exportBureauFormatBtn').addEventListener('click', () => {
    const choice = confirm('請選擇匯出方式：\n【確定】：一鍵列印/儲存為教育局標準 A4 橫式表格 PDF\n【取消】：下載符合 11 大欄位之 CSV / Excel 表格');
    if (choice) {
      exportToPrintPDF();
    } else {
      exportToCSV();
    }
  });
}

function exportToPrintPDF() {
  const data = store.getAll();
  const printBody = document.getElementById('bureauPrintTableBody');
  document.getElementById('printDateString').textContent = new Date().toISOString().split('T')[0];

  printBody.innerHTML = '';
  data.forEach((item, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align:center;">${item.sessionId || idx + 1}</td>
      <td>${item.date}</td>
      <td>${item.period}</td>
      <td style="text-align:center;">${item.className}</td>
      <td><strong>${item.teacher}</strong></td>
      <td>${item.subject}</td>
      <td>${item.unit}</td>
      <td>${item.prepHost || '-'}</td>
      <td>${(item.coPrepGroup || '-').replace(/\n/g, ' ')}</td>
      <td>${item.postPrepHost || '-'}</td>
      <td>${(item.observationGroup || '-').replace(/\n/g, ' ')}</td>
      <td style="text-align:center;">${item.openType}</td>
    `;
    printBody.appendChild(tr);
  });

  window.print();
}

function exportToCSV() {
  const data = store.getAll();
  const headers = [
    '場次', '公開授課日期', '節次', '班級', '授課教師', 
    '科目(領域)', '授課單元', '備課主持人', '共同備課教師類群', 
    '議課主持人', '觀課議課教師類群', '開放型態', '狀態'
  ];

  let csvContent = '\uFEFF' + headers.join(',') + '\n';
  data.forEach((item, idx) => {
    const row = [
      item.sessionId || idx + 1,
      `"${item.date}"`,
      `"${item.period}"`,
      `"${item.className}"`,
      `"${item.teacher}"`,
      `"${item.subject}"`,
      `"${(item.unit || '').replace(/"/g, '""')}"`,
      `"${(item.prepHost || '').replace(/"/g, '""')}"`,
      `"${(item.coPrepGroup || '').replace(/\n/g, ' ').replace(/"/g, '""')}"`,
      `"${(item.postPrepHost || '').replace(/"/g, '""')}"`,
      `"${(item.observationGroup || '').replace(/\n/g, ' ').replace(/"/g, '""')}"`,
      `"${item.openType}"`,
      `"${item.status}"`
    ];
    csvContent += row.join(',') + '\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${store.settings.siteTitle || '公開授課行事曆'}_彙整表_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
