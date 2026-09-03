/**
 * 115學年度新北市中山國民小學公開授課行事曆 - Google 試算表雲端同步後端 (Google Apps Script)
 * 
 * 【使用教學 3 步驟】：
 * 1. 建立一份新的 Google 試算表（例如命名為「中山國小115公開授課資料庫」）。
 * 2. 點選頂端選單「擴充功能」 -> 「Apps Script」。
 * 3. 清空裡面的內容，將本檔案程式碼全部複製貼上，點選右上角「部署」 -> 「新增部署作業」：
 *    - 種類選「網頁應用程式 (Web app)」
 *    - 執行身分：「我 (您的 Google 帳號)」
 *    - 誰可以存取：「任何人 (Anyone)」
 *    - 點選「部署」，複製產生的「網頁應用程式網址 (Web App URL)」，貼回網站教務處後台設定即可！
 */

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetData = getOrCreateSheet(ss,  公開授課明細);
    var sheetSettings = getOrCreateSheet(ss, 系統設定);

    var openClasses = readOpenClasses(sheetData);
    var settings = readSettings(sheetSettings);

    return ContentService.createTextOutput(JSON.stringify({
      status: success,
      openClasses: openClasses,
      settings: settings
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: error,
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetData = getOrCreateSheet(ss, 公開授課明細);
    var sheetSettings = getOrCreateSheet(ss, 系統設定);

    if (action === addOpenClass) {
      appendOpenClass(sheetData, payload.data);
    } else if (action === updateOpenClass) {
      updateOpenClass(sheetData, payload.id, payload.data);
    } else if (action === registerObserver) {
      registerObserver(sheetData, payload.id, payload.observer);
    } else if (action === updatePassword) {
      updatePassword(sheetSettings, payload.password);
    } else if (action === batchUpdateStatus) {
      batchUpdateStatus(sheetData, payload.ids, payload.status);
    } else if (action === syncAll) {
      syncAllData(sheetData, sheetSettings, payload.openClasses, payload.settings);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: success
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: error,
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

var HEADERS = [
  id, sessionId, date, period, className, teacher, subject, 
  unit, prepHost, coPrepGroup, postPrepHost, observationGroup, 
  openType, status, location, maxObservers, registeredObservers, 
  lessonPlanUrl, notes, createdDate
];

function getOrCreateSheet(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (sheetName === 公開授課明細) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setBackground(#fef08a).setFontWeight(bold);
    } else if (sheetName === 系統設定) {
      sheet.appendRow([設定鍵, 設定值]);
      sheet.appendRow([siteTitle, 115學年度新北市中山國民小學公開授課行事曆]);
      sheet.appendRow([siteSubtitle, 115學年度教師公開授課與觀課報名網]);
      sheet.appendRow([adminPassword, admin]);
      sheet.getRange(1, 1, 1, 2).setBackground(#fed7aa).setFontWeight(bold);
    }
  }
  return sheet;
}

function readOpenClasses(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headers = data[0];
  var result = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var item = {};
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j];
      var val = row[j];
      if (key === registeredObservers) {
        try {
          item[key] = val ? JSON.parse(val) : [];
        } catch (e) {
          item[key] = [];
        }
      } else if (key === date) {
        if (val instanceof Date) {
          var y = val.getFullYear();
          var m = String(val.getMonth() + 1).padStart(2, '0');
          var d = String(val.getDate()).padStart(2, '0');
          item[key] = y + - + m + - + d;
        } else {
          item[key] = String(val);
        }
      } else {
        item[key] = val;
      }
    }
    result.push(item);
  }
  return result;
}

function readSettings(sheet) {
  var data = sheet.getDataRange().getValues();
  var settings = {
    siteTitle: 115學年度新北市中山國民小學公開授課行事曆,
    siteSubtitle: 115學年度教師公開授課與觀課報名網,
    adminPassword: admin
  };
  for (var i = 1; i < data.length; i++) {
    var k = data[i][0];
    var v = data[i][1];
    if (k && v !== undefined) {
      settings[k] = String(v);
    }
  }
  return settings;
}

function appendOpenClass(sheet, item) {
  var row = [];
  for (var j = 0; j < HEADERS.length; j++) {
    var key = HEADERS[j];
    var val = item[key];
    if (key === registeredObservers) {
      row.push(JSON.stringify(val || []));
    } else {
      row.push(val !== undefined ? val : );
 }
 }
 sheet.appendRow(row);
}

function updateOpenClass(sheet, id, updatedData) {
 var data = sheet.getDataRange().getValues();
 for (var i = 1; i < data.length; i++) {
 if (String(data[i][0]) === String(id)) {
 for (var key in updatedData) {
 var colIdx = HEADERS.indexOf(key);
 if (colIdx !== -1) {
 var val = updatedData[key];
 if (key === registeredObservers) val = JSON.stringify(val);
 sheet.getRange(i + 1, colIdx + 1).setValue(val);
 }
 }
 break;
 }
 }
}

function registerObserver(sheet, id, observer) {
 var data = sheet.getDataRange().getValues();
 var regCol = HEADERS.indexOf(registeredObservers);
 for (var i = 1; i < data.length; i++) {
 if (String(data[i][0]) === String(id)) {
 var raw = data[i][regCol];
 var list = [];
 try { list = JSON.parse(raw) || []; } catch(e) {}
 list.push(observer);
 sheet.getRange(i + 1, regCol + 1).setValue(JSON.stringify(list));
 break;
 }
 }
}

function updatePassword(sheet, newPassword) {
 var data = sheet.getDataRange().getValues();
 var found = false;
 for (var i = 1; i < data.length; i++) {
 if (data[i][0] === adminPassword) {
 sheet.getRange(i + 1, 2).setValue(newPassword);
 found = true;
 break;
 }
 }
 if (!found) {
 sheet.appendRow([adminPassword, newPassword]);
 }
}

function batchUpdateStatus(sheet, ids, newStatus) {
 var data = sheet.getDataRange().getValues();
 var statusCol = HEADERS.indexOf(status);
 for (var i = 1; i < data.length; i++) {
 var id = String(data[i][0]);
 if (ids.indexOf(id) !== -1) {
 sheet.getRange(i + 1, statusCol + 1).setValue(newStatus);
 }
 }
}

function syncAllData(sheetData, sheetSettings, openClasses, settings) {
 // 清空舊明細並全量寫入
 sheetData.clearContents();
 sheetData.appendRow(HEADERS);
 sheetData.getRange(1, 1, 1, HEADERS.length).setBackground(#fef08a).setFontWeight(bold);
 for (var i = 0; i < openClasses.length; i++) {
 appendOpenClass(sheetData, openClasses[i]);
 }

 if (settings && settings.adminPassword) {
 updatePassword(sheetSettings, settings.adminPassword);
 }
}
