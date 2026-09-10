// 日期中文化格式化函式 (去除台北標準時間、GMT 等字眼，一律顯示為 2026年10月5日)
function formatDateChinese(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).trim();

  // 若已經是「YYYY年M月D日」格式
  if (/^\d{4}年\d{1,2}月\d{1,2}日$/.test(s)) {
    return s;
  }

  // 嘗試解析常見的 2026-10-05, 2026/10/05
  const match1 = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match1) {
    return `${match1[1]}年${parseInt(match1[2], 10)}月${parseInt(match1[3], 10)}日`;
  }

  // 嘗試解析 Date 物件或 "Mon Oct 05 2026 ... GMT+0800 (台北標準時間)"
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return `${y}年${m}月${day}日`;
  }

  // 正則抓取任意四位年份與其後的月日
  const match2 = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (match2) {
    return `${match2[1]}年${parseInt(match2[2], 10)}月${parseInt(match2[3], 10)}日`;
  }

  return s;
}

// 轉為 input[type=date] 標準的 YYYY-MM-DD
function normalizeDateIso(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).trim();

  const match = s.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})/);
  if (match) {
    const y = match[1];
    const m = match[2].padStart(2, '0');
    const day = match[3].padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return s;
}

// ==========================================================================
// 1. Data Store & Settings Management
// ==========================================================================
class DataStore {
  constructor() {
    this.storageDataKey = 'OPEN_CLASS_CALENDAR_DATA_V3';
    this.storageSettingsKey = 'OPEN_CLASS_SETTINGS_V2';
    this.storageSnapshotsKey = 'OPEN_CLASS_DAILY_SNAPSHOTS_V1';
    this.storageGasUrlKey = 'OPEN_CLASS_GAS_URL';
    this.storageDeletedIdsKey = 'OPEN_CLASS_DELETED_IDS_V1';
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

  getDeletedIds() {
    try {
      const raw = localStorage.getItem(this.storageDeletedIdsKey);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  addDeletedId(id) {
    if (!id) return;
    const list = this.getDeletedIds();
    if (!list.includes(id)) {
      list.push(id);
      localStorage.setItem(this.storageDeletedIdsKey, JSON.stringify(list));
    }
  }

  loadData() {
    const deletedIds = this.getDeletedIds();
    const keysToTry = ['OPEN_CLASS_CALENDAR_DATA_V3', 'OPEN_CLASS_CALENDAR_DATA_V2', 'OPEN_CLASS_CALENDAR_DATA_V1'];
    for (const key of keysToTry) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const filtered = parsed.filter(item => !deletedIds.includes(item.id));
            const hasLuo = filtered.some(item => item.teacher && item.teacher.includes('羅任鎗'));
            if (!hasLuo && !deletedIds.some(id => id.includes('608903'))) {
              const luoEntry = DEFAULT_OPEN_CLASSES.find(i => i.teacher === '羅任鎗');
              if (luoEntry && !deletedIds.includes(luoEntry.id)) filtered.push(luoEntry);
            }
            this.saveData(filtered);
            return filtered;
          }
        } catch (e) { console.error('Data migration error', e); }
      }
    }
    const initial = DEFAULT_OPEN_CLASSES.filter(item => !deletedIds.includes(item.id));
    this.saveData(initial);
    return [...initial];
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
    let docDriveUrl = 'https://drive.google.com';
    let docDriveTitle = '中山國小教務處雲端硬碟表件專區';
    let docNoticeText = '新北市政府教育局公開授課表件規範：\n授課教師於公開授課後，請繳交【表一：教學活動設計表】與【表三：教學省思與議課表】至教務處留校備查；觀課教師請繳交【表二：課堂觀察紀錄表】。';
    let customDocs = [];
    let standardDocs = {
      plan: { title: '教學活動設計表 (教案與共備重點)', desc: '授課人員填寫・含共同備課重點摘述與教學活動設計', fileName: null, fileData: null },
      obs: { title: '公開授課課堂觀察紀錄表 (觀課紀錄)', desc: '觀課人員填寫・含學生學習表現與教學觀察向度', fileName: null, fileData: null },
      post: { title: '教學省思心得與共同議課紀錄表', desc: '授課人員填寫・含議課照片紀錄與專業回饋研討', fileName: null, fileData: null }
    };

    // 優先讀取已修改的最新密碼與表件設定 (V2)
    const rawV2 = localStorage.getItem('OPEN_CLASS_SETTINGS_V2');
    if (rawV2) {
      try {
        const parsed = JSON.parse(rawV2);
        if (parsed) {
          if (parsed.adminPassword) savedPass = parsed.adminPassword;
          if (parsed.docDriveUrl !== undefined) docDriveUrl = parsed.docDriveUrl;
          if (parsed.docDriveTitle) docDriveTitle = parsed.docDriveTitle;
          if (parsed.docNoticeText !== undefined) docNoticeText = parsed.docNoticeText;
          if (Array.isArray(parsed.customDocs)) customDocs = parsed.customDocs;
          if (parsed.standardDocs) standardDocs = { ...standardDocs, ...parsed.standardDocs };
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

    const initialSettings = {
      siteTitle: fixedTitle,
      siteSubtitle: fixedSubtitle,
      adminPassword: savedPass,
      docDriveUrl: docDriveUrl,
      docDriveTitle: docDriveTitle,
      docNoticeText: docNoticeText,
      customDocs: customDocs,
      standardDocs: standardDocs
    };
    this.saveSettings(initialSettings);
    return initialSettings;
  }

  saveSettings(newSettings = this.settings) {
    this.settings = newSettings;
    localStorage.setItem(this.storageSettingsKey, JSON.stringify(newSettings));
    this.triggerDailySnapshot();
    this.pushToCloud('updateSettings', null, { settings: newSettings });
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

    // 依日期先後順序排列（由早到晚），若同一天則按節次順序排序
    result.sort((a, b) => {
      const dateA = normalizeDateIso(a.date);
      const dateB = normalizeDateIso(b.date);
      if (dateA !== dateB) {
        return dateA.localeCompare(dateB);
      }
      const pA = parseInt((a.period || '').replace(/\D/g, ''), 10) || 0;
      const pB = parseInt((b.period || '').replace(/\D/g, ''), 10) || 0;
      return pA - pB;
    });

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

  deleteEntry(id) {
    const idx = this.openClasses.findIndex(item => item.id === id);
    if (idx !== -1) {
      const removed = this.openClasses.splice(idx, 1)[0];
      this.addDeletedId(id);
      this.saveData();
      // 同時發送 deleteOpenClass 與 syncAll，確保舊版與新版 GAS 試算表均被清空重寫，徹底移除該筆紀錄
      this.pushToCloud('deleteOpenClass', null, { id: id });
      this.pushToCloud('syncAll', null, { openClasses: this.openClasses, settings: this.settings });
      return removed;
    }
    return null;
  }

  batchDelete(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    ids.forEach(id => this.addDeletedId(id));
    this.openClasses = this.openClasses.filter(item => !ids.includes(item.id));
    this.saveData();
    this.pushToCloud('syncAll', null, { openClasses: this.openClasses, settings: this.settings });
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
    } else if (state === 'error') {
      currentText = text || '雲端連線異常 (使用本機快取)';
      iconClass = 'fa-solid fa-triangle-exclamation';
      bg = '#fee2e2';
      color = '#b91c1c';
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

  async syncFromCloud(showToast = false) {
    if (!this.gasApiUrl) {
      this.updateCloudStatusBadge();
      return false;
    }

    try {
      this.updateCloudStatusBadge('syncing', '從雲端載入中...');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(this.gasApiUrl, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeoutId);
      const json = await res.json();

      if (json && json.status === 'success') {
        if (Array.isArray(json.openClasses)) {
          // 防禦性過濾：嚴格剔除所有已刪除名冊中的幽靈資料
          const deletedIds = this.getDeletedIds();
          const originalLen = json.openClasses.length;
          const filtered = json.openClasses.filter(item => !deletedIds.includes(item.id));

          // 若雲端試算表還殘留已刪除的幽靈資料，自動透過 syncAll 幫雲端試算表徹底清除！
          if (filtered.length < originalLen) {
            this.pushToCloud('syncAll', null, { openClasses: filtered, settings: this.settings });
          }

          if (filtered.length > 0) {
            this.openClasses = filtered;
            localStorage.setItem(this.storageDataKey, JSON.stringify(this.openClasses));
          } else if (filtered.length === 0 && this.openClasses.length > 0 && deletedIds.length === 0) {
            // 若雲端試算表剛建立還是空的，自動將現有資料同步初始化至雲端試算表！
            this.pushToCloud('syncAll', null, { openClasses: this.openClasses, settings: this.settings });
          }
        }

        if (json.settings && json.settings.siteTitle) {
          if (typeof json.settings.customDocs === 'string') {
            try {
              json.settings.customDocs = JSON.parse(json.settings.customDocs);
            } catch (e) {
              json.settings.customDocs = [];
            }
          }
          if (typeof json.settings.standardDocs === 'string') {
            try {
              json.settings.standardDocs = JSON.parse(json.settings.standardDocs);
            } catch (e) {
              json.settings.standardDocs = null;
            }
          }
          this.settings = { ...this.settings, ...json.settings };
          localStorage.setItem(this.storageSettingsKey, JSON.stringify(this.settings));
        }
        this.updateCloudStatusBadge();
        applySystemSettings();
        renderCurrentPortal();
        if (showToast) {
          alert('🟢 雲端同步成功！已載入最新公開授課資料與密碼設定。');
        }
        return true;
      }
    } catch (err) {
      console.warn('Cloud sync error, fallback to local storage:', err);
      this.updateCloudStatusBadge('error', '雲端連線異常 (使用本機快取)');
      if (showToast) {
        alert('⚠️ 雲端同步失敗，目前維持本機快取資料。請檢查網路連線。');
      }
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
  store.updateCloudStatusBadge();
  store.syncFromCloud();

  // 頂部雲端徽章點擊事件：手動重整同步
  const cloudBadge = document.getElementById('cloudStatusBadge');
  if (cloudBadge) {
    cloudBadge.style.cursor = 'pointer';
    cloudBadge.title = '點此立即重新同步 Google 試算表雲端資料';
    cloudBadge.addEventListener('click', () => {
      store.syncFromCloud(true);
    });
  }

  applySystemSettings();
  initPortalSwitcher();
  initFrontendFilters();
  initBackendTabs();
  initModals();
  initCalendarControls();
  initExportEngine();
  initSettingsForm();
  initDocSettingsForm();

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

  // 填入表件下載設定表單與動態更新表件下載視窗
  const settingDocDriveTitleInput = document.getElementById('settingDocDriveTitle');
  const settingDocDriveUrlInput = document.getElementById('settingDocDriveUrl');
  const settingDocNoticeTextInput = document.getElementById('settingDocNoticeText');
  const testDriveLinkBtn = document.getElementById('testDriveLinkBtn');

  if (settingDocDriveTitleInput) settingDocDriveTitleInput.value = store.settings.docDriveTitle || "中山國小教務處雲端硬碟表件專區";
  if (settingDocDriveUrlInput) settingDocDriveUrlInput.value = store.settings.docDriveUrl || "https://drive.google.com";
  if (settingDocNoticeTextInput) settingDocNoticeTextInput.value = store.settings.docNoticeText || "";
  if (testDriveLinkBtn) testDriveLinkBtn.href = store.settings.docDriveUrl || "https://drive.google.com";

  renderDownloadDocsModal();
  renderAdminStandardDocsList();
  renderAdminCustomDocsList();
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
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-muted" style="font-size: 0.98rem; padding: 2.5rem 1rem; line-height: 1.8;"><i class="fa-solid fa-clock-rotate-left" style="color: #64748b; margin-right: 6px;"></i>目前公開授課資料填報中，將經過校長同意後再行公告，預計時間為2026年9月30日</td></tr>`;
  } else {
    list.forEach((item, idx) => {
      const regCount = item.registeredObservers ? item.registeredObservers.length : 0;
      const maxObs = item.maxObservers || 10;
      const available = Math.max(0, maxObs - regCount);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${item.sessionId || idx + 1}</strong></td>
        <td>
          <div style="font-weight: 900; color: var(--primary); font-size: 0.95rem;">${formatDateChinese(item.date)}</div>
          <small class="text-muted">${item.period}</small>
        </td>
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

  const batchDeleteBtn = document.getElementById('batchDeleteBtn');
  if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener('click', () => {
      const selected = getSelectedPendingIds();
      if (selected.length === 0) return alert('請先勾選欲刪除的公開授課案件');
      if (!confirm(`確定要批次刪除所勾選的 ${selected.length} 筆公開授課申請嗎？\n\n⚠️ 刪除後將同步從 Google 雲端試算表徹底移除，請問是否確定刪除？`)) {
        return;
      }
      store.batchDelete(selected);
      alert(`已成功刪除 ${selected.length} 筆公開授課申請，並已同步更新至雲端！`);
      renderBackendPortal();
    });
  }
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
  } else if (store.adminSubView === 'docs') {
    renderAdminStandardDocsList();
    renderAdminCustomDocsList();
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
      <td><strong style="color: var(--primary); font-size: 0.95rem;">${formatDateChinese(item.date)}</strong><br><small class="text-muted">${item.period}</small></td>
      <td>${item.className} 班</td>
      <td>
        <strong>${item.teacher}</strong>
        ${item.teacherEmail ? `<br><small class="text-muted"><i class="fa-solid fa-envelope"></i> ${item.teacherEmail}</small>` : ''}
      </td>
      <td><span class="badge badge-approved">${item.subject}</span><br><small>${item.unit}</small></td>
      <td><span class="badge badge-type-${getOpenTypeBadgeClass(item.openType)}">${item.openType}</span></td>
      <td>${item.createdDate || '-'}</td>
      <td><span class="badge badge-${getStatusBadgeClass(item.status)}">${item.status}</span></td>
      <td style="white-space: nowrap;">
        <button class="btn btn-sm btn-sketch-success" onclick="adminApproveItem('${item.id}')" title="核准此申請">核准</button>
        <button class="btn btn-sm btn-sketch-primary" onclick="adminPublishItem('${item.id}')" title="發布公告至全校行事曆">發布公告</button>
        <button class="btn btn-sm btn-sketch-outline text-danger" onclick="adminReturnItem('${item.id}')" title="退回教師修正">退回</button>
        <button class="btn btn-sm btn-sketch-outline text-danger" onclick="adminDeleteClass('${item.id}')" title="刪除此公開課申請（清理重複或無效場次）"><i class="fa-solid fa-trash-can"></i> 刪除</button>
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
  const target = store.getAll().find(i => i.id === id);
  if (!target) return;

  const comment = prompt(`請輸入退回【${target.teacher} 老師】修正之具體原因與建議：`);
  if (comment !== null && comment.trim() !== '') {
    store.updateEntry(id, { status: '需修正', revisionComment: comment.trim() });

    const teacherEmail = target.teacherEmail || target.email;
    if (teacherEmail) {
      const emailSubject = `【新北市中山國小教務處】公開授課申請退回修正通知 - ${target.teacher}老師`;
      const emailBody = 
`${target.teacher} 老師 您好：

您於「115學年度新北市中山國民小學公開授課行事曆」所登記之場次：
● 授課日期：${formatDateChinese(target.date)} (${target.period})
● 班級領域：${target.className} 班 / ${target.subject}
● 單元名稱：${target.unit}

經教務處審核，請依以下意見進行修正：
--------------------------------------------------
【退回修正意見】：
${comment.trim()}
--------------------------------------------------

請點擊以下網址進入系統修正並重新送審：
https://budhead0808-design.github.io/open-class-calendar/

新北市板橋區中山國民小學 教務處 敬上`;

      // 嘗試透過 Google Apps Script 雲端寄發通知信
      store.pushToCloud('sendReturnEmail', null, {
        to: teacherEmail,
        subject: emailSubject,
        body: emailBody,
        teacher: target.teacher
      });

      // 同時提供 mailto 開啟本地郵件軟體發信確認
      const mailtoUrl = `mailto:${encodeURIComponent(teacherEmail)}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
      
      const shouldOpenClient = confirm(`已將案件狀態更新為「需修正」！\n\n系統已準備發送退件通知信給：\n📧 ${target.teacher} 老師 (${teacherEmail})\n\n是否立即開啟您的郵件軟體（如 Outlook / Gmail）預覽並發送此通知信？`);
      if (shouldOpenClient) {
        window.location.href = mailtoUrl;
      }
    } else {
      alert(`已退回案件並標註需修正！\n\n⚠️ 提醒：該筆資料未填寫教師 Email，請手動告知教師修正意見：\n「${comment.trim()}」`);
    }

    renderBackendPortal();
  }
}

function renderAdminMasterTable() {
  const tbody = document.getElementById('adminMasterTableBody');
  tbody.innerHTML = '';

  const all = store.getAll();
  all.forEach((item, idx) => {
    const regCount = item.registeredObservers ? item.registeredObservers.length : 0;
    const maxObs = item.maxObservers || 10;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${item.sessionId || idx + 1}</strong></td>
      <td><div style="font-weight: 900; color: var(--primary); font-size: 0.95rem;">${formatDateChinese(item.date)}</div><small class="text-muted">${item.period}</small></td>
      <td>${item.className} 班</td>
      <td>
        <strong>${item.teacher}</strong>
        ${item.teacherEmail ? `<br><small class="text-muted"><i class="fa-solid fa-envelope"></i> ${item.teacherEmail}</small>` : ''}
      </td>
      <td><span class="badge badge-approved">${item.subject}</span></td>
      <td>${item.unit}</td>
      <td>${item.prepHost || '-'}</td>
      <td><small>${(item.coPrepGroup || '-').replace(/\n/g, ' ')}</small></td>
      <td>${item.postPrepHost || '-'}</td>
      <td><small>${(item.observationGroup || '-').replace(/\n/g, ' ')}</small></td>
      <td><span class="badge badge-type-${getOpenTypeBadgeClass(item.openType)}">${item.openType}</span></td>
      <td><span class="badge badge-${getStatusBadgeClass(item.status)}">${item.status}</span></td>
      <td style="white-space: nowrap;">
        <button class="btn btn-sm btn-sketch-primary" style="margin-right: 4px;" onclick="openDetailModal('${item.id}')" title="管理本場次觀課教師名單與重複報名">
          <i class="fa-solid fa-users"></i> 觀課(${regCount}/${maxObs})
        </button>
        <button class="btn btn-sm btn-sketch-outline" style="margin-right: 4px;" onclick="openFormModal('${item.id}')" title="編輯此場次公開授課內容">
          <i class="fa-solid fa-pen"></i> 編輯
        </button>
        <button class="btn btn-sm btn-sketch-outline text-danger" onclick="adminDeleteClass('${item.id}')" title="刪除此筆公開課場次（清理重複填報場次）">
          <i class="fa-solid fa-trash-can"></i> 刪除
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// 教務處管理後台刪除公開課場次
window.adminDeleteClass = function(id) {
  const target = store.getAll().find(i => i.id === id);
  if (!target) return;
  if (!confirm(`確定要刪除【${target.teacher} 老師】的公開授課紀錄嗎？\n\n場次：${target.className}班 / ${target.subject} - ${target.unit}\n日期：${formatDateChinese(target.date)}\n狀態：${target.status}\n\n⚠️ 刪除後將同步從雲端 Google 試算表移除，請問是否確定刪除？`)) {
    return;
  }
  store.deleteEntry(id);
  alert(`已成功刪除【${target.teacher} 老師】的該筆公開授課場次，並已同步更新至雲端 Google 試算表！`);
  renderCurrentPortal();
};

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
    const dayEvents = events.filter(e => normalizeDateIso(e.date) === dateStr);

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
window.openDownloadDocsModal = function() {
  const modal = document.getElementById('downloadDocsModal');
  if (modal) {
    renderDownloadDocsModal();
    modal.classList.add('active');
  }
};

window.closeDownloadDocsModal = function() {
  const modal = document.getElementById('downloadDocsModal');
  if (modal) {
    modal.classList.remove('active');
  }
};

// 查詢我的公開授課申請與草稿 Modal
window.openMyApplicationsModal = function(defaultKeyword = '') {
  const modal = document.getElementById('myApplicationsModal');
  if (!modal) return;
  const input = document.getElementById('myAppSearchInput');
  if (input) input.value = defaultKeyword;
  modal.classList.add('active');
  searchMyApplications();
};

window.closeMyApplicationsModal = function() {
  const modal = document.getElementById('myApplicationsModal');
  if (modal) modal.classList.remove('active');
};

window.loadDraftIntoForm = function(id) {
  closeMyApplicationsModal();
  openFormModal(id);
};

window.searchMyApplications = function() {
  const input = document.getElementById('myAppSearchInput');
  const container = document.getElementById('myAppResultContainer');
  if (!container) return;

  const keyword = input ? input.value.trim().toLowerCase() : '';
  const all = store.getAll();

  let matched = [];
  if (keyword) {
    matched = all.filter(item => {
      const t = (item.teacher || '').toLowerCase();
      const em = (item.teacherEmail || item.email || '').toLowerCase();
      return t.includes(keyword) || em.includes(keyword);
    });
  } else {
    // 預設列出目前所有的草稿與需修正項目，方便老師一進來就能看到
    matched = all.filter(item => item.status === '草稿' || item.status === '需修正');
  }

  if (matched.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted); background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 8px;">
        <i class="fa-solid fa-folder-open" style="font-size: 2rem; margin-bottom: 0.5rem; color: #94a3b8; display: block;"></i>
        ${keyword ? `查無【${keyword}】老師的申請或草稿紀錄。<br><small style="color:#64748b;">請確認姓名是否填寫正確，或點擊「教師線上登記公開課」填寫新申請。</small>` : '目前尚無儲存中的草稿或退回需修正案件。<br><small style="color:#64748b;">請在上方搜尋欄輸入您的教師姓名進行查詢。</small>'}
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  matched.forEach(item => {
    const card = document.createElement('div');
    card.className = 'sketch-card';
    
    let statusBadge = '';
    let actionBtn = '';
    let cardBg = '#ffffff';
    let borderColor = 'var(--ink-border)';

    if (item.status === '草稿') {
      cardBg = '#fefce8';
      borderColor = '#eab308';
      statusBadge = '<span class="badge badge-draft" style="font-size: 0.82rem; background:#fef08a; color:#854d0e; border:1px solid #eab308;"><i class="fa-solid fa-floppy-disk"></i> 未送出草稿</span>';
      actionBtn = `
        <button type="button" class="btn btn-sm btn-sketch-success" onclick="loadDraftIntoForm('${item.id}')" style="font-weight: 900; background:#16a34a; color:white;">
          <i class="fa-solid fa-file-pen"></i> 繼續填寫 / 送出送審
        </button>
      `;
    } else if (item.status === '需修正') {
      cardBg = '#fef2f2';
      borderColor = '#ef4444';
      statusBadge = '<span class="badge text-danger" style="background:#fee2e2; border:1px solid #f87171; font-size:0.82rem; color:#991b1b;"><i class="fa-solid fa-triangle-exclamation"></i> 需退回修正</span>';
      actionBtn = `
        <button type="button" class="btn btn-sm btn-sketch-primary" onclick="loadDraftIntoForm('${item.id}')" style="font-weight: 900;">
          <i class="fa-solid fa-pen-to-square"></i> 依意見修正並送審
        </button>
      `;
    } else if (item.status === '待審核') {
      cardBg = '#f0f9ff';
      borderColor = '#0284c7';
      statusBadge = '<span class="badge badge-draft" style="background:#e0f2fe; color:#0369a1; border:1px solid #7dd3fc; font-size:0.82rem;"><i class="fa-solid fa-clock"></i> 教務處審核中</span>';
      actionBtn = `
        <button type="button" class="btn btn-sm btn-sketch-outline" onclick="loadDraftIntoForm('${item.id}')">
          <i class="fa-solid fa-eye"></i> 檢視內容
        </button>
      `;
    } else {
      cardBg = '#f0fdf4';
      borderColor = '#16a34a';
      statusBadge = `<span class="badge badge-approved" style="font-size:0.82rem;"><i class="fa-solid fa-circle-check"></i> ${item.status}</span>`;
      actionBtn = `
        <button type="button" class="btn btn-sm btn-sketch-outline" onclick="loadDraftIntoForm('${item.id}')">
          <i class="fa-solid fa-eye"></i> 檢視明細
        </button>
      `;
    }

    card.style.cssText = `padding: 0.85rem 1rem; background: ${cardBg}; border: 2px solid ${borderColor}; border-radius: 8px; margin-bottom: 6px;`;
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
        <div>
          <strong style="font-size: 1rem; color: var(--primary);">${item.teacher} 老師</strong>
          <span style="font-size: 0.85rem; color: var(--text-muted); margin-left: 6px;">(${item.className} 班 / ${item.subject})</span>
        </div>
        <div>${statusBadge}</div>
      </div>
      <div style="font-size: 0.92rem; margin-bottom: 6px; font-weight: 700; color: var(--text-main);">
        單元：${item.unit}
      </div>
      <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 8px; display: flex; gap: 12px; flex-wrap: wrap;">
        <span><i class="fa-regular fa-calendar"></i> 預計日期：${formatDateChinese(item.date)} (${item.period})</span>
        ${item.location ? `<span><i class="fa-solid fa-location-dot"></i> 地點：${item.location}</span>` : ''}
      </div>
      ${item.revisionComment ? `
        <div style="background: white; border: 1.5px dashed #ef4444; padding: 6px 10px; border-radius: 6px; margin-bottom: 8px; font-size: 0.85rem; color: #991b1b; line-height: 1.4;">
          <strong>教務處退回意見：</strong>${item.revisionComment}
        </div>
      ` : ''}
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;">
        ${actionBtn}
      </div>
    `;
    container.appendChild(card);
  });
};

function initModals() {
  const openClassModal = document.getElementById('openClassModal');
  const detailModal = document.getElementById('detailModal');
  const downloadDocsModal = document.getElementById('downloadDocsModal');
  const downloadDocsBtn = document.getElementById('downloadDocsBtn');
  const closeDownloadDocsModalBtn = document.getElementById('closeDownloadDocsModalBtn');
  const closeDownloadDocsFooterBtn = document.getElementById('closeDownloadDocsFooterBtn');

  if (downloadDocsBtn) {
    downloadDocsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.openDownloadDocsModal();
    });
  }

  if (closeDownloadDocsModalBtn) {
    closeDownloadDocsModalBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.closeDownloadDocsModal();
    });
  }

  if (closeDownloadDocsFooterBtn) {
    closeDownloadDocsFooterBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.closeDownloadDocsModal();
    });
  }

  const myAppSearchInput = document.getElementById('myAppSearchInput');
  if (myAppSearchInput) {
    myAppSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.searchMyApplications();
      }
    });
  }

  document.getElementById('closeFormModalBtn').addEventListener('click', () => openClassModal.classList.remove('active'));
  document.getElementById('closeDetailModalBtn').addEventListener('click', () => detailModal.classList.remove('active'));

  document.getElementById('openClassForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveOpenClassFromForm('待審核');
  });

  document.getElementById('saveDraftBtn').addEventListener('click', () => {
    saveOpenClassFromForm('草稿');
  });

  // 教師姓名即時防重複填寫驗證
  const teacherInput = document.getElementById('formTeacher');
  const emailInput = document.getElementById('formEmail');
  const warningEl = document.getElementById('teacherDuplicateWarning');

  function validateTeacherDuplicate() {
    if (!teacherInput) return;
    const editId = document.getElementById('formEntryId') ? document.getElementById('formEntryId').value : null;
    const existing = checkTeacherAlreadyRegistered(teacherInput.value, emailInput ? emailInput.value : '', editId);

    if (existing && warningEl) {
      warningEl.style.display = 'block';

      if (existing.status === '草稿') {
        warningEl.style.background = '#fefce8';
        warningEl.style.borderColor = '#ca8a04';
        warningEl.style.color = '#854d0e';
        warningEl.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div>
              <i class="fa-solid fa-floppy-disk" style="color: #ca8a04; margin-right: 4px;"></i>
              <strong>偵測到您先前已存有【草稿】</strong>（${existing.subject} - ${existing.unit}）
            </div>
            <button type="button" class="btn btn-sm btn-sketch-primary" style="padding: 2px 10px; font-size: 0.82rem; font-weight: 900; background: #2563eb; color: white;" onclick="loadDraftIntoForm('${existing.id}')">
              <i class="fa-solid fa-file-pen"></i> 直接載入此草稿繼續填寫
            </button>
          </div>
        `;
      } else if (existing.status === '需修正') {
        warningEl.style.background = '#fef2f2';
        warningEl.style.borderColor = '#f87171';
        warningEl.style.color = '#991b1b';
        warningEl.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div>
              <i class="fa-solid fa-triangle-exclamation" style="color: #dc2626; margin-right: 4px;"></i>
              <strong>教務處退回需修正：</strong>${existing.revisionComment || '請修正後重新送審'}
            </div>
            <button type="button" class="btn btn-sm btn-sketch-primary" style="padding: 2px 10px; font-size: 0.82rem; font-weight: 900; background: #e11d48; color: white;" onclick="loadDraftIntoForm('${existing.id}')">
              <i class="fa-solid fa-pen-to-square"></i> 載入進行修正
            </button>
          </div>
        `;
      } else {
        warningEl.style.background = '#fef2f2';
        warningEl.style.borderColor = '#f87171';
        warningEl.style.color = '#dc2626';
        warningEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>你已經填寫過申請</strong>（${existing.teacher} 老師於 ${formatDateChinese(existing.date)} 已登記「${existing.subject} - ${existing.unit}」，狀態：${existing.status}）`;
      }
    } else if (warningEl) {
      warningEl.style.display = 'none';
    }
  }

  if (teacherInput) {
    teacherInput.addEventListener('input', validateTeacherDuplicate);
    teacherInput.addEventListener('change', validateTeacherDuplicate);
  }
  if (emailInput) {
    emailInput.addEventListener('input', validateTeacherDuplicate);
    emailInput.addEventListener('change', validateTeacherDuplicate);
  }

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

// 檢查教師是否已填寫過公開授課申請
function checkTeacherAlreadyRegistered(teacherName, teacherEmail, currentId = null) {
  const name = (teacherName || '').trim().replace(/\s+/g, '');
  const email = (teacherEmail || '').trim().toLowerCase();
  if (!name && !email) return null;

  return store.getAll().find(item => {
    if (currentId && item.id === currentId) return false;

    const itemTeacher = (item.teacher || '').trim().replace(/\s+/g, '');
    if (name && itemTeacher && itemTeacher === name) {
      return true;
    }

    const itemEmail = (item.teacherEmail || item.email || '').trim().toLowerCase();
    if (email && itemEmail && itemEmail === email) {
      return true;
    }

    return false;
  }) || null;
}

function openFormModal(editId = null) {
  const modal = document.getElementById('openClassModal');
  const title = document.getElementById('modalFormTitle');
  const form = document.getElementById('openClassForm');
  const optionalSection = document.getElementById('optionalFieldsSection');
  const optionalBtnText = document.getElementById('optionalBtnText');
  const warningEl = document.getElementById('teacherDuplicateWarning');
  if (warningEl) warningEl.style.display = 'none';
  form.reset();

  if (editId) {
    const target = store.getAll().find(i => i.id === editId);
    if (target) {
      if (target.status === '草稿') {
        title.innerHTML = `<i class="fa-solid fa-file-pen" style="color: #ca8a04;"></i> 繼續填寫公開授課草稿 (可儲存草稿或直接送審)`;
      } else if (target.status === '需修正') {
        title.innerHTML = `<i class="fa-solid fa-pen-to-square" style="color: #e11d48;"></i> 依意見修正公開授課申請 (修正後請送審)`;
      } else {
        title.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> 編輯公開授課登記 (教育局 11 欄位)`;
      }

      document.getElementById('formEntryId').value = target.id;
      document.getElementById('formDate').value = normalizeDateIso(target.date);
      document.getElementById('formPeriod').value = target.period;
      document.getElementById('formClassName').value = target.className;
      document.getElementById('formTeacher').value = target.teacher;
      document.getElementById('formEmail').value = target.teacherEmail || target.email || '';
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
    document.getElementById('formEmail').value = '';
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
  let id = document.getElementById('formEntryId').value;
  const teacherVal = document.getElementById('formTeacher').value;
  const emailVal = document.getElementById('formEmail').value;

  // 防呆：每位教師限填寫一次公開授課申請
  const existing = checkTeacherAlreadyRegistered(teacherVal, emailVal, id);
  if (existing) {
    if (!id && existing.status === '草稿') {
      const actionText = targetStatus === '草稿' ? '儲存更新至該筆草稿' : '更新該筆草稿並正式送出審核';
      if (confirm(`偵測到您先前已存有草稿（單元：${existing.subject} - ${existing.unit}）。\n\n是否直接將本次填寫內容${actionText}？`)) {
        id = existing.id;
        document.getElementById('formEntryId').value = existing.id;
      } else {
        return;
      }
    } else if (!id && existing.status === '需修正') {
      if (confirm(`偵測到您先前有教務處退回需修正之案件（單元：${existing.subject} - ${existing.unit}）。\n\n是否將本次填寫內容更新至該案件並送出審核？`)) {
        id = existing.id;
        document.getElementById('formEntryId').value = existing.id;
      } else {
        return;
      }
    } else {
      if (store.currentPortal === 'frontend') {
        alert('你已經填寫過申請');
        return;
      } else {
        const ok = confirm(`【教務處管理者提醒】\n你已經填寫過申請（${existing.teacher} 老師於 ${formatDateChinese(existing.date)} 已有「${existing.subject} - ${existing.unit}」場次）。\n\n請問是否仍要強制代填新增？（如欲修改原資料，建議直接點選「編輯」）`);
        if (!ok) return;
      }
    }
  }

  const entryData = {
    date: document.getElementById('formDate').value,
    period: document.getElementById('formPeriod').value,
    className: document.getElementById('formClassName').value,
    teacher: teacherVal.trim(),
    teacherEmail: emailVal.trim(),
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
    alert(targetStatus === '草稿' ? '💾 已成功更新公開授課草稿！' : '🎉 已成功送出申請，等待教務處審核！');
  } else {
    store.addEntry(entryData);
    alert(targetStatus === '草稿' ? '💾 已成功儲存草稿！' : '🎉 已成功送出申請，等待教務處審核！');
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

  const observers = target.registeredObservers || [];
  const nameCounts = {};
  observers.forEach(o => {
    const n = (o.name || '').trim();
    nameCounts[n] = (nameCounts[n] || 0) + 1;
  });
  const hasDuplicates = Object.values(nameCounts).some(c => c > 1);

  body.innerHTML = `
    <div style="margin-bottom: 1rem;">
      <span class="badge badge-type-${getOpenTypeBadgeClass(target.openType)}" style="font-size: 0.9rem;">${target.openType}公開授課</span>
      <span class="badge badge-${getStatusBadgeClass(target.status)}" style="font-size: 0.9rem;">${target.status}</span>
    </div>

    <h2 style="font-size: 1.3rem; margin-bottom: 1rem; color: var(--primary);">${target.subject} - ${target.unit}</h2>

    <div class="form-grid-2 sketch-card" style="background: #fefce8; padding: 1rem; margin-bottom: 1rem;">
      <div><strong>公開授課日期：</strong> <span style="font-weight: 900; color: var(--primary);">${formatDateChinese(target.date)}</span> (${target.period})</div>
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
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 8px;">
        <h4 style="margin: 0;"><i class="fa-solid fa-users"></i> 觀課報名名冊 (${regCount}/${maxObs} 人)</h4>
        ${store.currentPortal === 'backend' ? `
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            ${hasDuplicates ? `
              <button type="button" class="btn btn-sm btn-sketch-danger" onclick="adminRemoveDuplicateObservers('${target.id}')">
                <i class="fa-solid fa-wand-magic-sparkles"></i> 一鍵清除重複報名
              </button>
            ` : ''}
            <button type="button" class="btn btn-sm btn-sketch-outline" onclick="adminAddObserverPrompt('${target.id}')">
              <i class="fa-solid fa-user-plus"></i> 手動登記觀課教師
            </button>
          </div>
        ` : ''}
      </div>

      ${hasDuplicates && store.currentPortal === 'backend' ? `
        <div style="background: #fff1f2; color: #be123c; padding: 8px 12px; border-radius: 6px; font-size: 0.85rem; font-weight: 700; margin-bottom: 0.75rem; border: 1.5px solid #f43f5e;">
          <i class="fa-solid fa-triangle-exclamation"></i> 系統偵測到有教師重複報名！可點擊上方「一鍵清除重複報名」自動保留首筆，或點擊下方「修改/移除」。
        </div>
      ` : ''}

      ${regCount > 0 ? `
        <div class="table-responsive" style="margin-bottom: 1.25rem;">
          <table class="table table-bordered sketch-table" style="font-size: 0.88rem; margin: 0; background: white; width: 100%;">
            <thead>
              <tr style="background: #f1f5f9;">
                <th style="width: 40px; text-align: center;">#</th>
                <th>觀課教師</th>
                <th>服務學校 / 單位</th>
                <th>登記時間</th>
                ${store.currentPortal === 'backend' ? `<th style="width: 125px; text-align: center;">教務處操作</th>` : ''}
              </tr>
            </thead>
            <tbody>
              ${observers.map((o, oIdx) => {
                const isDup = nameCounts[(o.name || '').trim()] > 1;
                return `
                  <tr style="${isDup ? 'background: #fff1f2;' : ''}">
                    <td style="text-align: center;">${oIdx + 1}</td>
                    <td>
                      <strong>${o.name}</strong>
                      ${isDup ? `<span class="badge" style="background: #ef4444; color: white; margin-left: 4px; font-size: 0.72rem; padding: 2px 6px;">重複報名</span>` : ''}
                    </td>
                    <td>${o.school || '本校'}</td>
                    <td><small class="text-muted">${o.time || '-'}</small></td>
                    ${store.currentPortal === 'backend' ? `
                      <td style="text-align: center; white-space: nowrap;">
                        <button type="button" class="btn btn-sm btn-sketch-outline" style="padding: 2px 6px; font-size: 0.75rem;" onclick="adminEditObserver('${target.id}', ${oIdx})">
                          <i class="fa-solid fa-pen"></i> 修改
                        </button>
                        <button type="button" class="btn btn-sm btn-sketch-danger" style="padding: 2px 6px; font-size: 0.75rem;" onclick="adminDeleteObserver('${target.id}', ${oIdx})">
                          <i class="fa-solid fa-trash"></i> 移除
                        </button>
                      </td>
                    ` : ''}
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : `<p class="text-muted" style="font-size: 0.85rem; margin-bottom: 1rem;">目前尚無教師登記觀課。</p>`}

      ${store.currentPortal !== 'backend' ? `
        <div style="border-top: 1.5px dashed var(--ink-border); padding-top: 0.75rem;">
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
      ` : ''}
    </div>
  `;

  modal.classList.add('active');
}

// 教務處觀課名單操作函式
function adminEditObserver(classId, index) {
  const target = store.getAll().find(i => i.id === classId);
  if (!target || !target.registeredObservers || !target.registeredObservers[index]) return;

  const current = target.registeredObservers[index];
  const newName = prompt('請輸入修改後的觀課教師姓名：', current.name);
  if (newName === null || newName.trim() === '') return;

  const newSchool = prompt('請輸入觀課教師服務學校 / 單位：', current.school || '本校');
  if (newSchool === null) return;

  target.registeredObservers[index].name = newName.trim();
  target.registeredObservers[index].school = newSchool.trim() || '本校';

  store.updateEntry(classId, { registeredObservers: target.registeredObservers });
  alert(`✅ 已成功更新觀課教師為：${newName.trim()} (${newSchool.trim() || '本校'})`);
  openDetailModal(classId);
  renderCurrentPortal();
}

function adminDeleteObserver(classId, index) {
  const target = store.getAll().find(i => i.id === classId);
  if (!target || !target.registeredObservers || !target.registeredObservers[index]) return;

  const targetObs = target.registeredObservers[index];
  if (!confirm(`確定要將【${targetObs.name} (${targetObs.school || '本校'})】自觀課名單中移除嗎？`)) {
    return;
  }

  target.registeredObservers.splice(index, 1);
  store.updateEntry(classId, { registeredObservers: target.registeredObservers });
  alert(`✅ 已成功移除該筆觀課登記！`);
  openDetailModal(classId);
  renderCurrentPortal();
}

function adminRemoveDuplicateObservers(classId) {
  const target = store.getAll().find(i => i.id === classId);
  if (!target || !target.registeredObservers) return;

  const originalCount = target.registeredObservers.length;
  const seen = new Set();
  const deduplicated = [];

  target.registeredObservers.forEach(o => {
    const key = (o.name || '').trim();
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(o);
    }
  });

  const removedCount = originalCount - deduplicated.length;
  if (removedCount === 0) {
    return alert('目前觀課名單中沒有重複的教師姓名！');
  }

  if (!confirm(`系統偵測到 ${removedCount} 筆重複報名紀錄，確定要一鍵清除並自動保留首筆報名嗎？`)) {
    return;
  }

  target.registeredObservers = deduplicated;
  store.updateEntry(classId, { registeredObservers: deduplicated });
  alert(`🎉 已成功清除 ${removedCount} 筆重複報名！目前觀課名單共 ${deduplicated.length} 位教師。`);
  openDetailModal(classId);
  renderCurrentPortal();
}

function adminAddObserverPrompt(classId) {
  const target = store.getAll().find(i => i.id === classId);
  if (!target) return;

  const name = prompt('請輸入欲登記之觀課教師姓名：');
  if (!name || name.trim() === '') return;

  const school = prompt('請輸入觀課教師服務學校 / 單位：', '本校');
  if (school === null) return;

  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  store.registerObserver(classId, {
    name: name.trim(),
    school: school.trim() || '本校',
    time: `${timeStr} (教務處登記)`
  });

  alert(`✅ 已成功為【${name.trim()} 老師】登記入席！`);
  openDetailModal(classId);
  renderCurrentPortal();
}

function handleRegisterObserver(e, id) {
  e.preventDefault();
  const name = document.getElementById('regObsName').value.trim();
  const school = document.getElementById('regObsSchool').value.trim();

  const target = store.getAll().find(i => i.id === id);
  if (target && target.registeredObservers) {
    const isExisting = target.registeredObservers.some(o => (o.name || '').trim() === name);
    if (isExisting) {
      if (!confirm(`⚠️ 提醒：名單中已存在【${name} 老師】的報名紀錄！\n\n請問確定仍要再次重複登記送出嗎？`)) {
        return;
      }
    }
  }

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
      <td>${formatDateChinese(item.date)}</td>
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
      `"${formatDateChinese(item.date)}"`,
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

// ==========================================================================
// 8. 表件下載引擎 (Word .doc 格式即時生成)
// ==========================================================================
function downloadDocTemplate(type) {
  // 若管理員已上傳自訂檔案，直接下載管理員上傳的專屬檔案！
  const standardDocs = (store.settings && store.settings.standardDocs) ? store.settings.standardDocs : {};
  if (standardDocs[type] && standardDocs[type].fileData) {
    const a = document.createElement('a');
    a.href = standardDocs[type].fileData;
    a.download = standardDocs[type].fileName || `公開授課_${standardDocs[type].title}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  let fileName = "";
  let html = "";

  if (type === 'plan') {
    fileName = "115學年度新北市中山國小_表件一_教學活動設計與共備表.doc";
    html = `
      <div class="header-title">新北市板橋區中山國民小學 115 學年度教師公開授課</div>
      <div class="sub-title">【表件一】教學活動設計表 (含共同備課重點摘述)</div>
      <table>
        <tr>
          <td style="width: 15%; background: #f2f2f2; font-weight: bold;">授課教師</td>
          <td style="width: 35%;"></td>
          <td style="width: 15%; background: #f2f2f2; font-weight: bold;">授課班級</td>
          <td style="width: 35%;">____年____班</td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold;">教學領域/科目</td>
          <td></td>
          <td style="background: #f2f2f2; font-weight: bold;">公開授課時間</td>
          <td>____年____月____日 第____節</td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold;">單元名稱與主題</td>
          <td colspan="3"></td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold;">共同備課時間</td>
          <td>____年____月____日</td>
          <td style="background: #f2f2f2; font-weight: bold;">備課主持人</td>
          <td></td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold;">共同備課人員</td>
          <td colspan="3" style="height: 50px;"></td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold;">共同備課重點摘述</td>
          <td colspan="3" style="height: 120px;">
            1. 學生先備經驗與起點行為分析：<br><br>
            2. 教學目標與核心素養對應：<br><br>
            3. 教學策略、數位輔具或活動設計：<br><br>
            4. 評量方式與課堂觀察重點：
          </td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold;">教學活動設計歷程</td>
          <td colspan="3" style="height: 250px;">
            【準備活動 / 引起動機】：<br><br><br>
            【發展活動 / 核心教學】：<br><br><br>
            【綜合活動 / 歸納評量】：<br><br>
          </td>
        </tr>
      </table>
    `;
  } else if (type === 'obs') {
    fileName = "115學年度新北市中山國小_表件二_公開授課課堂觀察紀錄表.doc";
    html = `
      <div class="header-title">新北市板橋區中山國民小學 115 學年度教師公開授課</div>
      <div class="sub-title">【表件二】課堂觀察紀錄表 (觀課人員填寫)</div>
      <table>
        <tr>
          <td style="width: 15%; background: #f2f2f2; font-weight: bold;">授課教師</td>
          <td style="width: 35%;"></td>
          <td style="width: 15%; background: #f2f2f2; font-weight: bold;">觀課人員</td>
          <td style="width: 35%;"></td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold;">授課領域/科目</td>
          <td></td>
          <td style="background: #f2f2f2; font-weight: bold;">觀課班級/節次</td>
          <td>____班 / 第____節</td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold;">單元名稱</td>
          <td colspan="3"></td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold; text-align: center;">觀察向度</td>
          <td colspan="2" style="background: #f2f2f2; font-weight: bold; text-align: center;">具體課堂觀察事實描述 (學生學習表現與教師引導)</td>
          <td style="background: #f2f2f2; font-weight: bold; text-align: center; width: 25%;">省思與建議回饋</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">一、學生學習表現<br><small>(專注投入、小組互動、迷思概念等)</small></td>
          <td colspan="2" style="height: 140px;"></td>
          <td></td>
        </tr>
        <tr>
          <td style="font-weight: bold;">二、教師教學策略<br><small>(提問設計、數位輔具運用、個別差異指導等)</small></td>
          <td colspan="2" style="height: 140px;"></td>
          <td></td>
        </tr>
        <tr>
          <td style="font-weight: bold;">三、學習氣氛與環境<br><small>(班級常規、師生互動氛圍等)</small></td>
          <td colspan="2" style="height: 100px;"></td>
          <td></td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold;">觀課人員綜合回饋與心得</td>
          <td colspan="3" style="height: 100px;"></td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold;">觀課人員簽章</td>
          <td colspan="3">簽章：________________________　　觀課日期：____年____月____日</td>
        </tr>
      </table>
    `;
  } else if (type === 'post') {
    fileName = "115學年度新北市中山國小_表件三_教學省思與共同議課紀錄表.doc";
    html = `
      <div class="header-title">新北市板橋區中山國民小學 115 學年度教師公開授課</div>
      <div class="sub-title">【表件三】教學省思心得與共同議課紀錄表 (授課人員填寫)</div>
      <table>
        <tr>
          <td style="width: 15%; background: #f2f2f2; font-weight: bold;">授課教師</td>
          <td style="width: 35%;"></td>
          <td style="width: 15%; background: #f2f2f2; font-weight: bold;">議課主持人</td>
          <td style="width: 35%;"></td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold;">授課領域/班級</td>
          <td></td>
          <td style="background: #f2f2f2; font-weight: bold;">議課時間與地點</td>
          <td>____年____月____日 / </td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold;">共同議課人員</td>
          <td colspan="3" style="height: 50px;"></td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold;">授課教師自我教學省思</td>
          <td colspan="3" style="height: 140px;">
            1. 本次課堂教學目標達成情形：<br><br>
            2. 學生課堂學習成效與亮點：<br><br>
            3. 遇見之困難或日後精進方向：
          </td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold;">觀課教師專業回饋摘述</td>
          <td colspan="3" style="height: 140px;"></td>
        </tr>
        <tr>
          <td style="background: #f2f2f2; font-weight: bold;">公開授課與議課照片黏貼紀錄 (請貼 2~4 張照片並附簡述)</td>
          <td colspan="3" style="height: 240px; text-align: center; vertical-align: middle; color: #888;">
            【照片一：課堂教學活動/共備照片】　　　　　　【照片二：學生學習/分組操作照片】<br><br><br><br>
            【照片三：觀課教師觀察視角】　　　　　　　【照片四：議課研討與回饋照片】
          </td>
        </tr>
      </table>
    `;
  }

  const docWrapper = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>${fileName}</title>
      <style>
        body { font-family: '標楷體', 'BiauKai', 'DFKai-SB', 'Times New Roman', serif; line-height: 1.6; font-size: 12pt; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        td, th { border: 1px solid #000; padding: 7px 10px; }
        .header-title { text-align: center; font-size: 16pt; font-weight: bold; margin-bottom: 4px; }
        .sub-title { text-align: center; font-size: 13pt; font-weight: bold; margin-bottom: 12px; }
      </style>
    </head>
    <body>
      ${html}
    </body>
    </html>
  `;

  const blob = new Blob([docWrapper], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ==========================================================================
// 9. 表件管理與雲端資源動態引擎 (教務處後台專用)
// ==========================================================================

// 動態渲染前台「公開授課表件下載 Modal」
function renderDownloadDocsModal() {
  const modalNoticeBox = document.getElementById('modalNoticeBox');
  const modalNoticeContent = document.getElementById('modalNoticeContent');
  const displayDocDriveTitle = document.getElementById('displayDocDriveTitle');
  const driveDownloadLink = document.getElementById('driveDownloadLink');
  const dynamicContainer = document.getElementById('dynamicCustomDocsContainer');

  const settings = store.settings || {};
  const standardDocs = settings.standardDocs || {};

  // 1. 渲染宣導規範文字
  if (modalNoticeBox && modalNoticeContent) {
    if (settings.docNoticeText && settings.docNoticeText.trim() !== '') {
      modalNoticeBox.style.display = 'block';
      modalNoticeContent.innerHTML = settings.docNoticeText.replace(/\n/g, '<br>');
    } else {
      modalNoticeBox.style.display = 'none';
    }
  }

  // 2. 渲染教務處 Google 雲端硬碟連結與標題
  if (displayDocDriveTitle) {
    displayDocDriveTitle.innerHTML = `<i class="fa-brands fa-google-drive"></i> ${settings.docDriveTitle || '中山國小教務處雲端硬碟表件專區'}`;
  }
  if (driveDownloadLink) {
    driveDownloadLink.href = settings.docDriveUrl || 'https://drive.google.com';
  }

  // 2.5 更新標準表一、表二、表三的下載狀態與標示
  const updateStandardCard = (key, cardId, titleId, descId, actionsId, defaultName) => {
    const card = document.getElementById(cardId);
    const titleEl = document.getElementById(titleId);
    const descEl = document.getElementById(descId);
    const actionsEl = document.getElementById(actionsId);
    if (!card || !actionsEl) return;

    const docConfig = standardDocs[key];
    if (docConfig && docConfig.fileData) {
      if (titleEl && docConfig.title) titleEl.textContent = docConfig.title;
      if (descEl) descEl.innerHTML = `<span style="color:#16a34a; font-weight:bold;"><i class="fa-solid fa-circle-check"></i> 教務處已自訂上傳檔案：</span> ${docConfig.fileName || '專屬表件'}`;
      actionsEl.innerHTML = `
        <button type="button" class="btn btn-sm btn-sketch-success" onclick="downloadDocTemplate('${key}')">
          <i class="fa-solid fa-cloud-arrow-down"></i> 下載自訂表件 (${docConfig.fileName || '專屬檔案'})
        </button>
      `;
    } else {
      if (titleEl && docConfig && docConfig.title) titleEl.textContent = docConfig.title;
      if (descEl && docConfig && docConfig.desc) descEl.textContent = docConfig.desc;
      actionsEl.innerHTML = `
        <button type="button" class="btn btn-sm btn-sketch-primary" onclick="downloadDocTemplate('${key}')">
          <i class="fa-solid fa-file-word"></i> 下載 Word 表格 (.doc)
        </button>
      `;
    }
  };

  updateStandardCard('plan', 'docCardPlan', 'docTitlePlan', 'docDescPlan', 'docActionsPlan', '教學活動設計表');
  updateStandardCard('obs', 'docCardObs', 'docTitleObs', 'docDescObs', 'docActionsObs', '課堂觀察紀錄表');
  updateStandardCard('post', 'docCardPost', 'docTitlePost', 'docDescPost', 'docActionsPost', '教學省思心得與共同議課紀錄表');

  // 3. 動態渲染自訂表件卡片
  if (dynamicContainer) {
    dynamicContainer.innerHTML = '';
    const customList = Array.isArray(settings.customDocs) ? settings.customDocs : [];

    customList.forEach((doc, idx) => {
      const card = document.createElement('div');
      card.className = 'doc-card sketch-card';
      card.style.cssText = 'padding: 1rem; background: white; border: 2px solid var(--ink-border);';

      const tagColor = doc.tagColor || '#059669';
      const tagName = doc.tag || '校內資源';
      const iconClass = doc.iconClass || 'fa-solid fa-file-lines';

      card.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 0.75rem;">
          <span class="badge" style="background: ${tagColor}20; color: ${tagColor}; border: 1.5px solid ${tagColor}; font-size: 0.85rem; padding: 4px 8px; flex-shrink: 0; font-weight: bold;">
            ${tagName}
          </span>
          <div>
            <h4 style="margin: 0; font-size: 0.98rem; color: var(--text-main);">${doc.title || '自訂表件'}</h4>
            <small class="text-muted">${doc.desc || '教務處自訂下載項目'}</small>
          </div>
        </div>
        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 0.5rem;">
          ${doc.fileData ? `
            <button type="button" class="btn btn-sm btn-sketch-success" onclick="downloadCustomFile('${doc.id}')">
              <i class="${iconClass}"></i> 下載檔案 (${doc.fileName || '表件檔案'})
            </button>
          ` : `
            <a href="${doc.url || '#'}" target="_blank" class="btn btn-sm btn-sketch-primary">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> 開啟 / 下載資源
            </a>
          `}
        </div>
      `;
      dynamicContainer.appendChild(card);
    });
  }
}

// 下載後台管理員上傳之 Base64 自訂表件檔案
window.downloadCustomFile = function(docId) {
  const customList = Array.isArray(store.settings.customDocs) ? store.settings.customDocs : [];
  const doc = customList.find(d => d.id === docId);
  if (!doc || !doc.fileData) return alert('找不到該檔案資料！');

  const a = document.createElement('a');
  a.href = doc.fileData;
  a.download = doc.fileName || '公開授課表件';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

// 後台表件管理設定表單監聽與即時更新
function initDocSettingsForm() {
  const form = document.getElementById('docSettingsForm');
  if (!form) return;

  const titleInput = document.getElementById('settingDocDriveTitle');
  const urlInput = document.getElementById('settingDocDriveUrl');
  const noticeInput = document.getElementById('settingDocNoticeText');
  const testBtn = document.getElementById('testDriveLinkBtn');
  const addDocBtn = document.getElementById('addCustomDocItemBtn');

  if (urlInput && testBtn) {
    urlInput.addEventListener('input', () => {
      testBtn.href = urlInput.value.trim() || '#';
    });
  }

  if (addDocBtn) {
    addDocBtn.addEventListener('click', () => {
      addCustomDocPrompt();
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const driveTitle = titleInput ? titleInput.value.trim() : '中山國小教務處雲端硬碟表件專區';
    const driveUrl = urlInput ? urlInput.value.trim() : 'https://drive.google.com';
    const noticeText = noticeInput ? noticeInput.value.trim() : '';

    store.settings.docDriveTitle = driveTitle;
    store.settings.docDriveUrl = driveUrl;
    store.settings.docNoticeText = noticeText;

    store.saveSettings();
    renderDownloadDocsModal();

    alert('🎉 教務處表件管理與雲端連結已成功儲存！\n前台老師點選「公開授課表件下載」即刻看到最新內容！');
  });
}

// 渲染教務處後台「常用表件清單編輯器」
function renderAdminCustomDocsList() {
  const container = document.getElementById('customDocsAdminList');
  if (!container) return;

  const customDocs = Array.isArray(store.settings.customDocs) ? store.settings.customDocs : [];
  container.innerHTML = '';

  if (customDocs.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 1.5rem; background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 8px; color: var(--text-muted);">
        <i class="fa-solid fa-folder-open" style="font-size: 1.5rem; margin-bottom: 0.5rem; color: #94a3b8; display: block;"></i>
        目前尚未新增任何自訂表件或雲端資源。<br>
        <small>點選上方「＋ 新增表件 / 外部檔案資源」按鈕，即可隨時上傳學校專屬表件、Word/PDF 或 Google 雲端連結！</small>
      </div>
    `;
    return;
  }

  customDocs.forEach((doc, idx) => {
    const itemCard = document.createElement('div');
    itemCard.className = 'sketch-card';
    itemCard.style.cssText = 'padding: 0.85rem 1rem; background: #fafafa; border: 1.5px solid var(--ink-border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;';

    itemCard.innerHTML = `
      <div style="flex: 1; min-width: 240px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <span class="badge" style="background: ${doc.tagColor || '#059669'}20; color: ${doc.tagColor || '#059669'}; border: 1px solid ${doc.tagColor || '#059669'}; font-size: 0.8rem; padding: 2px 6px;">
            ${doc.tag || '表件資源'}
          </span>
          <strong style="color: var(--text-main); font-size: 0.95rem;">${doc.title}</strong>
        </div>
        <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 4px;">
          ${doc.desc || '無備註說明'}
        </div>
        <div style="font-size: 0.78rem; color: #64748b;">
          ${doc.fileData ? `<i class="fa-solid fa-paperclip"></i> 已上傳本機檔案: <strong>${doc.fileName}</strong>` : `<i class="fa-solid fa-link"></i> 下載連結: <a href="${doc.url}" target="_blank" style="color: #2563eb;">${doc.url}</a>`}
        </div>
      </div>
      <div style="display: flex; gap: 6px; flex-shrink: 0;">
        <button type="button" class="btn btn-sm btn-sketch-secondary" onclick="editCustomDocPrompt('${doc.id}')">
          <i class="fa-solid fa-pen-to-square"></i> 編輯
        </button>
        <button type="button" class="btn btn-sm btn-sketch-outline text-danger" onclick="deleteCustomDoc('${doc.id}')">
          <i class="fa-solid fa-trash-can"></i> 刪除
        </button>
      </div>
    `;
    container.appendChild(itemCard);
  });
}

// 新增自訂表件對話框
window.addCustomDocPrompt = function() {
  const title = prompt('【步驟 1/3】請輸入表件名稱 (例如: 115公開授課成果照片黏貼單範本)：');
  if (!title || title.trim() === '') return;

  const desc = prompt('【步驟 2/3】請輸入表件說明摘要 (例如: 授課教師撰寫成果或議課時使用)：', '教務處自訂下載表件');
  if (desc === null) return;

  const choice = confirm('【步驟 3/3】請選擇新增方式：\n\n【確定】：直接輸入 Google 雲端硬碟或外部下載網址 (URL)\n【取消】：直接自電腦上傳檔案 (Word/PDF/Excel/圖片，檔案將直接嵌入系統)');

  if (choice) {
    const url = prompt('請輸入檔案下載網址或 Google Drive 雲端連結：', 'https://drive.google.com');
    if (!url || url.trim() === '') return;

    const newDoc = {
      id: 'DOC-' + Date.now().toString().slice(-6),
      title: title.trim(),
      desc: desc.trim(),
      url: url.trim(),
      tag: '自訂資源',
      tagColor: '#2563eb'
    };

    if (!Array.isArray(store.settings.customDocs)) store.settings.customDocs = [];
    store.settings.customDocs.push(newDoc);
    store.saveSettings();
    renderAdminCustomDocsList();
    renderDownloadDocsModal();
    alert('✅ 已成功新增自訂表件連結！');
  } else {
    // 建立檔案選擇器
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.doc,.docx,.pdf,.odt,.xls,.xlsx,.ppt,.pptx,.jpg,.png,.zip';
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 5 * 1024 * 1024) {
        return alert('⚠️ 檔案大小超過 5MB，建議上傳至 Google 雲端硬碟並使用網址連結！');
      }

      const reader = new FileReader();
      reader.onload = (evt) => {
        const fileBase64 = evt.target.result;
        const newDoc = {
          id: 'DOC-' + Date.now().toString().slice(-6),
          title: title.trim(),
          desc: desc.trim(),
          fileName: file.name,
          fileData: fileBase64,
          tag: '上傳檔案',
          tagColor: '#16a34a'
        };

        if (!Array.isArray(store.settings.customDocs)) store.settings.customDocs = [];
        store.settings.customDocs.push(newDoc);
        store.saveSettings();
        renderAdminCustomDocsList();
        renderDownloadDocsModal();
        alert(`✅ 已成功上傳表件【${file.name}】！`);
      };
      reader.readAsDataURL(file);
    };
    fileInput.click();
  }
};

// 編輯自訂表件對話框
window.editCustomDocPrompt = function(docId) {
  const customDocs = Array.isArray(store.settings.customDocs) ? store.settings.customDocs : [];
  const doc = customDocs.find(d => d.id === docId);
  if (!doc) return;

  const newTitle = prompt('請輸入修改後的表件名稱：', doc.title);
  if (!newTitle || newTitle.trim() === '') return;

  const newDesc = prompt('請輸入修改後的說明摘要：', doc.desc);
  if (newDesc === null) return;

  doc.title = newTitle.trim();
  doc.desc = newDesc.trim();

  if (!doc.fileData) {
    const newUrl = prompt('請輸入下載網址：', doc.url || 'https://drive.google.com');
    if (newUrl) doc.url = newUrl.trim();
  }

  store.saveSettings();
  renderAdminCustomDocsList();
  renderDownloadDocsModal();
  alert('✅ 表件資訊已成功更新！');
};

// 刪除自訂表件
window.deleteCustomDoc = function(docId) {
  const customDocs = Array.isArray(store.settings.customDocs) ? store.settings.customDocs : [];
  const idx = customDocs.findIndex(d => d.id === docId);
  if (idx === -1) return;

  if (confirm(`確定要刪除表件【${customDocs[idx].title}】嗎？`)) {
    customDocs.splice(idx, 1);
    store.saveSettings();
    renderAdminCustomDocsList();
    renderDownloadDocsModal();
    alert('✅ 已刪除該表件項目！');
  }
};

// ==========================================================================
// 10. 表件一、表件二、表件三 專屬檔案上傳管理引擎
// ==========================================================================

// 渲染後台「表件一、表二、表三 自訂檔案上傳專區」
function renderAdminStandardDocsList() {
  const container = document.getElementById('standardDocsAdminList');
  if (!container) return;

  if (!store.settings.standardDocs) {
    store.settings.standardDocs = {
      plan: { title: '教學活動設計表 (教案與共備重點)', desc: '授課人員填寫・含共同備課重點摘述與教學活動設計', fileName: null, fileData: null },
      obs: { title: '公開授課課堂觀察紀錄表 (觀課紀錄)', desc: '觀課人員填寫・含學生學習表現與教學觀察向度', fileName: null, fileData: null },
      post: { title: '教學省思心得與共同議課紀錄表', desc: '授課人員填寫・含議課照片紀錄與專業回饋研討', fileName: null, fileData: null }
    };
  }

  const standardDocs = store.settings.standardDocs;
  const items = [
    { key: 'plan', tag: '表件一', badgeClass: 'badge-approved', defaultName: '新北市中山國小_表件一_教學活動設計與共備表.doc' },
    { key: 'obs', tag: '表件二', badgeClass: 'badge-draft', defaultName: '新北市中山國小_表件二_公開授課課堂觀察紀錄表.doc' },
    { key: 'post', tag: '表件三', badgeClass: 'badge-type-district', defaultName: '新北市中山國小_表件三_教學省思與共同議課紀錄表.doc' }
  ];

  container.innerHTML = '';

  items.forEach(item => {
    const config = standardDocs[item.key] || {};
    const hasCustomFile = !!config.fileData;

    const div = document.createElement('div');
    div.className = 'sketch-card';
    div.style.cssText = `padding: 1rem; background: ${hasCustomFile ? '#f0fdf4' : '#ffffff'}; border: 2px solid ${hasCustomFile ? '#16a34a' : 'var(--ink-border)'}; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;`;

    div.innerHTML = `
      <div style="flex: 1; min-width: 260px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <span class="badge ${item.badgeClass}" style="font-size: 0.85rem; padding: 3px 8px;">${item.tag}</span>
          <strong style="font-size: 1rem; color: var(--text-main);">${config.title || item.tag}</strong>
          ${hasCustomFile ? `<span class="badge badge-approved" style="background:#dcfce7; color:#15803d; border:1px solid #16a34a;"><i class="fa-solid fa-circle-check"></i> 已使用您上傳的專屬檔案</span>` : `<span class="badge" style="background:#f1f5f9; color:#64748b;"><i class="fa-solid fa-code"></i> 使用系統標準 Word 樣板</span>`}
        </div>
        <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 6px;">
          ${config.desc || ''}
        </div>
        <div style="font-size: 0.82rem;">
          ${hasCustomFile ? `
            <span style="color: #166534;"><i class="fa-solid fa-paperclip"></i> 目前檔案：<strong>${config.fileName}</strong></span>
          ` : `
            <span style="color: #64748b;"><i class="fa-solid fa-file-word"></i> 預設檔案：<strong>${item.defaultName}</strong> (點擊時自動產出標準 Word)</span>
          `}
        </div>
      </div>
      <div style="display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap;">
        ${hasCustomFile ? `
          <button type="button" class="btn btn-sm btn-sketch-primary" onclick="downloadDocTemplate('${item.key}')">
            <i class="fa-solid fa-download"></i> 檢視下載檔案
          </button>
          <button type="button" class="btn btn-sm btn-sketch-success" onclick="uploadStandardDocFile('${item.key}')">
            <i class="fa-solid fa-arrow-up-from-bracket"></i> 替換檔案
          </button>
          <button type="button" class="btn btn-sm btn-sketch-outline text-danger" onclick="resetStandardDocFile('${item.key}')">
            <i class="fa-solid fa-rotate-left"></i> 恢復預設樣板
          </button>
        ` : `
          <button type="button" class="btn btn-sm btn-sketch-primary" onclick="downloadDocTemplate('${item.key}')">
            <i class="fa-solid fa-download"></i> 預覽預設 Word
          </button>
          <button type="button" class="btn btn-sm btn-sketch-success" onclick="uploadStandardDocFile('${item.key}')">
            <i class="fa-solid fa-cloud-arrow-up"></i> 上傳專屬檔案 (.doc/.docx/.pdf/.odt)
          </button>
        `}
      </div>
    `;

    container.appendChild(div);
  });
}

// 觸發上傳特定表件（表一、表二、表三）專屬檔案
window.uploadStandardDocFile = function(type) {
  const names = {
    plan: '表件一 (教學活動設計表)',
    obs: '表件二 (課堂觀察紀錄表)',
    post: '表件三 (教學省思與議課紀錄表)'
  };
  const typeName = names[type] || type;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.doc,.docx,.pdf,.odt,.xls,.xlsx';
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      return alert('⚠️ 檔案大小超過 8MB，請壓縮或減小檔案後再上傳！');
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      const fileBase64 = evt.target.result;

      if (!store.settings.standardDocs) store.settings.standardDocs = {};
      if (!store.settings.standardDocs[type]) store.settings.standardDocs[type] = {};

      store.settings.standardDocs[type].fileName = file.name;
      store.settings.standardDocs[type].fileData = fileBase64;

      store.saveSettings();
      renderAdminStandardDocsList();
      renderDownloadDocsModal();

      alert(`🎉 成功上傳！【${typeName}】已成功替換為您的專屬檔案：\n📄 ${file.name}\n\n前台老師點選下載時，將直接下載此專屬檔案！`);
    };
    reader.readAsDataURL(file);
  };
  fileInput.click();
};

// 恢復特定表件（表一、表二、表三）為預設 Word 樣板
window.resetStandardDocFile = function(type) {
  const names = {
    plan: '表件一',
    obs: '表件二',
    post: '表件三'
  };
  const typeName = names[type] || type;

  if (!confirm(`確定要將【${typeName}】恢復為系統標準 Word 生成樣板嗎？\n恢復後將清除已上傳的自訂檔案。`)) {
    return;
  }

  if (store.settings.standardDocs && store.settings.standardDocs[type]) {
    store.settings.standardDocs[type].fileName = null;
    store.settings.standardDocs[type].fileData = null;
  }

  store.saveSettings();
  renderAdminStandardDocsList();
  renderDownloadDocsModal();

  alert(`✅ 已將【${typeName}】恢復為系統標準 Word 樣板！`);
};


