const SPREADSHEET_ID = "1vkYB2a4MRw7MWjml-fneEMgPCptbGyQlRY3WweoWHe4"; 

// ==========================================
// 1. API Routing (รับส่งข้อมูลกับหน้าบ้าน)
// ==========================================
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const data = payload.data;

    let result = {};
    if (action === 'getInitialData') result = getInitialData();
    else if (action === 'getPRHistory') result = getPRHistory();
    else if (action === 'createPR') result = createPR(data);
    else if (action === 'approvePR') result = approvePR(data);
    else if (action === 'rejectPR') result = rejectPR(data);
    else if (action === 'createPO') result = createPO(data); 
    else if (action === 'bulkReceivePO') result = bulkReceivePO(data);
    else if (action === 'closePO') result = closePO(data);
    else if (action === 'deletePO') result = deletePO(data);
    else result = { success: false, message: "Action not found" };

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Server Error", errorDetail: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}
function doOptions(e) { return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT); }

// ==========================================
// 2. Setup Database (สร้าง Sheet อัตโนมัติถ้าไม่มี)
// ==========================================
function setupDatabase(ss) {
  const sheets = {
    'PR': ['PR_UID', 'PR_Date', 'PR_Number', 'Requester', 'Warehouse', 'SKU', 'Product', 'Request_Qty', 'Unit', 'Remark', 'Status', 'Approver_Remark'],
    'PO': ['PO_UID', 'Ref_PR_UID', 'PO_Date', 'PO_Number', 'Vendor', 'Warehouse', 'SKU', 'Product', 'PO_Qty', 'Unit', 'Expected_Date', 'Status', 'Remark'],
    'GR': ['GR_UID', 'Ref_PO_UID', 'GR_Date', 'ATA', 'Receiver', 'SKU', 'Product', 'GR_Qty', 'Unit', 'Loc_IN', 'Exp_Date', 'Leadtime_Days', 'Remark', 'Status', 'Old_Stock']
  };

  for (let name in sheets) {
    if (!ss.getSheetByName(name)) {
      let sh = ss.insertSheet(name);
      sh.appendRow(sheets[name]);
      sh.getRange("A1:" + String.fromCharCode(64 + sheets[name].length) + "1").setBackground("#171C8F").setFontColor("white").setFontWeight("bold");
    }
  }
}

// ==========================================
// 3. ดึงข้อมูลให้หน้าบ้าน (Merge Data)
// ==========================================
function getInitialData() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    setupDatabase(ss); 

    const targetSheets = ['Vendor', 'ProductName', 'PR', 'GR', 'PO'];
    const sheetData = {};
    const allSheets = ss.getSheets();
    
    for (let i = 0; i < allSheets.length; i++) {
      let sName = allSheets[i].getName();
      if (targetSheets.includes(sName)) {
        let lastRow = allSheets[i].getLastRow();
        let lastCol = allSheets[i].getLastColumn();
        sheetData[sName] = (lastRow > 1) ? allSheets[i].getRange(2, 1, lastRow - 1, Math.max(lastCol, 15)).getValues() : [];
      }
    }

    let vendors = sheetData['Vendor'] ? sheetData['Vendor'].map(r => r[1]).filter(String) : [];
    
    let products = sheetData['ProductName'] ? sheetData['ProductName'].map(r => ({ 
        sku: r[0] || '',       
        name: r[1],            
        unit: r[3] || '',      
        oldStock: r[4] || 0,   
        vendor: r[5] || ''     
    })).filter(p => p.name) : [];

    let prList = [];
    if (sheetData['PR']) {
      prList = sheetData['PR'].filter(r => r[10] === 'Pending').map((r, i) => ({
        uid: r[0], rowNumber: i+2, poDate: r[1] instanceof Date ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), "dd/MM/yyyy") : r[1],
        prNumber: r[2], receiverName: r[3], warehouse: r[4], sku: r[5], product: r[6], quantity: r[7], unit: r[8], remark: r[9]
      }));
    }

    let grMap = {}; 
    if (sheetData['GR']) {
      sheetData['GR'].forEach(r => {
        let refPoUid = r[1];
        if(!grMap[refPoUid]) grMap[refPoUid] = [];
        grMap[refPoUid].push({
          grUid: r[0], ata: r[3] instanceof Date ? Utilities.formatDate(r[3], Session.getScriptTimeZone(), "dd/MM/yyyy") : r[3],
          receiver: r[4], sku: r[5], grProduct: r[6], grQty: r[7], unit: r[8], locIn: r[9], exp: r[10], leadtime: r[11], remark: r[12], status: r[13], oldStock: r[14] || ""
        });
      });
    }

    let pendingPOs = [], grCompleted = [], apvList = [];
    if (sheetData['PO']) {
      const today = new Date();
      sheetData['PO'].forEach((r, i) => {
        let poUid = r[0];
        let poDateRaw = r[2];
        let poDateStr = poDateRaw instanceof Date ? Utilities.formatDate(poDateRaw, Session.getScriptTimeZone(), "dd/MM/yyyy") : poDateRaw;
        let poStatus = r[11]; 
        
        let relatedGRs = grMap[poUid] || [];
        let activeGR = relatedGRs[relatedGRs.length - 1] || {};
        let latestGRStatus = activeGR.status || "";

        let activeStatus = poStatus;
        if (poStatus !== 'PO Closed - Ready for APV') {
            if (latestGRStatus === 'GR Completed' || latestGRStatus === 'Completed' || poStatus === 'GR Completed') {
                activeStatus = 'GR Completed';
            } else if (latestGRStatus === 'Pending Review' || poStatus === 'Pending Review') {
                activeStatus = 'Pending Review';
            } else if (latestGRStatus === 'Draft GR' || poStatus === 'Draft GR') {
                activeStatus = 'Draft GR';
            }
        }

        let displayStatus = activeStatus;
        if (activeStatus === 'Pending GR' && poDateRaw instanceof Date) {
          if (Math.floor((today.getTime() - poDateRaw.getTime()) / (1000 * 3600 * 24)) > 7) displayStatus = 'Overdue';
        }

        let combinedItem = {
          uid: poUid, rowNumber: i+2, poDate: poDateStr, poNumber: r[3], vendor: r[4], warehouse: r[5],
          sku: r[6], product: r[7], quantity: r[8], unit: r[9], remark: r[12],
          status: activeStatus, displayStatus: displayStatus,
          grQty: activeGR.grQty || "", locIn: activeGR.locIn || "", exp: activeGR.exp || "",
          ata: activeGR.ata || "", receiverName: activeGR.receiver || "", leadtime: activeGR.leadtime || "",
          oldStock: activeGR.oldStock || ""
        };

        if (activeStatus === 'Pending GR' || activeStatus === 'Draft GR' || activeStatus === 'Pending Review') {
            pendingPOs.push(combinedItem);
        }
        if (activeStatus === 'GR Completed') {
            grCompleted.push(combinedItem);
        }
        if (activeStatus === 'PO Closed - Ready for APV') {
            apvList.push(combinedItem);
        }
      });
    }

    return { success: true, vendors, products, prList, pendingPOs, grCompleted, apvList };
  } catch (error) { return { success: false, message: "Load data failed", errorDetail: error.toString() }; }
}

function getPRHistory() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const prSheet = ss.getSheetByName('PR');
    if (!prSheet || prSheet.getLastRow() < 2) return { success: true, history: [] };

    const prData = prSheet.getRange(2, 1, prSheet.getLastRow() - 1, Math.max(prSheet.getLastColumn(), 12)).getValues();
    let history = [];
    
    for (let i = prData.length - 1; i >= 0; i--) {
      const row = prData[i];
      let dateStr = row[1] instanceof Date ? Utilities.formatDate(row[1], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : row[1];

      history.push({
        date: dateStr, prNumber: row[2], requester: row[3], warehouse: row[4],
        sku: row[5], product: row[6], quantity: row[7], unit: row[8] || '', remark: row[9] || '', status: row[10] || 'Pending'
      });
      if (history.length >= 100) break;
    }

    return { success: true, history: history };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

// ==========================================
// 4. การจัดการคำขอ (PR)
// ==========================================
function createPR(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const prSheet = ss.getSheetByName('PR');
  const today = new Date();
  const prNumber = "PR-" + Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyyMMdd") + "-" + Math.floor(1000+Math.random()*9000);
  
  const newRows = data.items.map(item => [
    Utilities.generateUuid(), today, prNumber, data.requester, data.warehouse, 
    item.sku || "", item.product, item.quantity, item.unit || "", item.remark || "", "Pending", ""
  ]);
  
  prSheet.getRange(prSheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  return { success: true, message: `ส่ง PR สำเร็จ: ${prNumber}` };
}

function rejectPR(data) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const prSheet = ss.getSheetByName('PR');
    
    let rowData = prSheet.getRange(data.rowNumber, 10, 1, 2).getValues()[0];
    let currentRemark = rowData[0];
    let newRemark = currentRemark ? `${currentRemark}\n${data.remark}` : data.remark;
    let targetStatus = data.status || "Rejected";
    
    prSheet.getRange(data.rowNumber, 10, 1, 2).setValues([[newRemark, targetStatus]]);
    
    return { success: true, message: `ทำรายการเรียบร้อยแล้ว` };
  } catch (error) {
    return { success: false, message: "เกิดข้อผิดพลาดในการทำรายการ", errorDetail: error.toString() };
  }
}

// ==========================================
// 5. การจัดการสั่งซื้อ (PO)
// ==========================================
function approvePR(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const prSheet = ss.getSheetByName('PR');
  const poSheet = ss.getSheetByName('PO');
  
  const prData = prSheet.getRange(data.prRowNumber, 1, 1, 3).getValues()[0];
  const prUid = prData[0];
  const prNumber = prData[2];
  
  prSheet.getRange(data.prRowNumber, 11).setValue("Approved"); 

  const today = new Date();
  const newRows = data.items.map(item => [
    Utilities.generateUuid(), prUid, today, data.poNumber || "", data.vendor, data.warehouse,
    item.sku || "", item.product, item.quantity, item.unit || "", "", "Pending GR", `อ้างอิง PR: ${prNumber}`
  ]);
  
  if (newRows.length > 0) poSheet.getRange(poSheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  return { success: true, message: `สร้าง PO จาก ${prNumber} สำเร็จ` };
}

function createPO(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const poSheet = ss.getSheetByName('PO');
  const today = new Date();
  
  const newRows = data.items.map(item => [
    Utilities.generateUuid(), "DIRECT", today, data.poNumber || "", data.vendor, data.warehouse,
    item.sku || "", item.product, item.quantity, item.unit || "", "", "Pending GR", "Direct PO"
  ]);
  
  poSheet.getRange(poSheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  return { success: true, message: "สร้าง Direct PO สำเร็จ" };
}

function deletePO(data) {
    try {
        const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
        const poSheet = ss.getSheetByName('PO');
        const rowsToDelete = data.rowNumbers.sort((a, b) => b - a); 
        rowsToDelete.forEach(row => poSheet.deleteRow(row));
        return { success: true, message: `ลบบิล PO เรียบร้อยแล้ว` };
    } catch(e) {
        return { success: false, message: "ลบไม่สำเร็จ", errorDetail: e.toString() };
    }
}

// ==========================================
// 6. การรับสินค้าลงคลัง (GR) & LINE Notify
// ==========================================
function bulkReceivePO(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const grSheet = ss.getSheetByName('GR');
  const poSheet = ss.getSheetByName('PO');
  const today = new Date();
  
  let ataParts = data.ata.split('/');
  let ataDate = new Date(ataParts[2], ataParts[1] - 1, ataParts[0]); 

  let poDateRaw = null;
  if(data.groupInfo.poDate) {
    let pParts = data.groupInfo.poDate.split('/');
    if(pParts.length === 3) poDateRaw = new Date(pParts[2], pParts[1] - 1, pParts[0]);
  }
  
  let leadtimeDays = "";
  if(poDateRaw && ataDate) leadtimeDays = Math.floor((ataDate.getTime() - poDateRaw.getTime()) / (1000 * 3600 * 24));

  const grRowsToInsert = [];
  
  let lineItemsText = "";
  let lineOldStockText = "";
  let itemCounter = 1;

  data.items.forEach(item => {
    let poRow = parseInt(item.rowNumber); 
    let poUid = poSheet.getRange(poRow, 1).getValue(); 
    let poSku = poSheet.getRange(poRow, 7).getValue(); 
    let productName = poSheet.getRange(poRow, 8).getValue(); 

    grRowsToInsert.push([
      Utilities.generateUuid(), poUid, today, ataDate, data.receiverName, poSku, productName, 
      item.grQty, item.unit, item.locIn, item.exp, leadtimeDays, data.remark, data.targetStatus, item.oldStock || ""
    ]);

    if (data.targetStatus === 'GR Completed') poSheet.getRange(poRow, 12).setValue('GR Completed');
    else if (data.targetStatus === 'Pending Review') poSheet.getRange(poRow, 12).setValue('Pending Review');
    else poSheet.getRange(poRow, 12).setValue('Draft GR');
    
    if(item.grQty && parseFloat(item.grQty) > 0) {
       lineItemsText += `${itemCounter}. ${productName} จำนวน ${item.grQty} ${item.unit || ''}\n`;
       if (item.oldStock) lineOldStockText += `- ${productName}: ${item.oldStock}\n`;
       itemCounter++;
    }
  });

  if (data.extraItems && data.extraItems.length > 0) {
    data.extraItems.forEach(ex => {
      grRowsToInsert.push([
        Utilities.generateUuid(), "EXTRA", today, ataDate, data.receiverName, ex.sku || "", ex.product, 
        ex.grQty, ex.unit, ex.locIn, ex.exp, leadtimeDays, "[นอกบิล/ของแถม] " + data.remark, data.targetStatus, ex.oldStock || ""
      ]);
      
      if(ex.grQty && parseFloat(ex.grQty) > 0) {
         lineItemsText += `${itemCounter}. ${ex.product} จำนวน ${ex.grQty} ${ex.unit || ''} (ของแถม/นอกบิล)\n`;
         if (ex.oldStock) lineOldStockText += `- ${ex.product}: ${ex.oldStock}\n`;
         itemCounter++;
      }
    });
  }

  if (grRowsToInsert.length > 0) {
    grSheet.getRange(grSheet.getLastRow() + 1, 1, grRowsToInsert.length, grRowsToInsert[0].length).setValues(grRowsToInsert);
  }

  // ---- 1. ส่งแจ้งเตือนเมื่อพนักงานกด "รับสินค้าเสร็จ" (Pending Review) ----
  if (data.targetStatus === 'Pending Review') {
      if(lineOldStockText === "") lineOldStockText = "- ไม่ได้ระบุ -\n";
      let lineMsg = `📦 สินค้าเข้า : รับลงสินค้าแล้ว (รอตรวจสอบ)\n`;
      lineMsg += `🏢 Vendor: ${data.groupInfo.vendor}\n`;
      lineMsg += `🏠 คลังสินค้า: ${data.groupInfo.warehouse}\n`;
      lineMsg += `📅 วันที่รับ: ${data.ata}\n`;
      lineMsg += `📋 รายการที่ลง:\n${lineItemsText}\n`;
      lineMsg += `📦 จำนวนคงเหลือเดิม:\n${lineOldStockText}\n`;
      if(data.remark) lineMsg += `📝 หมายเหตุ: ${data.remark}\n`;
      lineMsg += `👤 ผู้ลงสินค้า: ${data.receiverName}`;

      sendLineMessageAPI(lineMsg, 'REVIEW');
  }

  // ---- 2. ส่งแจ้งเตือนเมื่อผู้มีอำนาจกด "ยืนยันรับสินค้า" (GR Completed) ----
  if (data.targetStatus === 'GR Completed') {
      if(lineOldStockText === "") lineOldStockText = "- ไม่ได้ระบุ -\n";
      let lineMsg = `✅ อนุมัติรับเข้าคลังเรียบร้อย (GR Completed)\n`;
      lineMsg += `🏢 Vendor: ${data.groupInfo.vendor}\n`;
      lineMsg += `🏠 คลังสินค้า: ${data.groupInfo.warehouse}\n`;
      lineMsg += `📅 วันที่รับ: ${data.ata}\n`;
      lineMsg += `📋 รายการตรวจสอบแล้ว:\n${lineItemsText}\n`;
      if(data.remark) lineMsg += `📝 หมายเหตุ: ${data.remark}\n`;
      lineMsg += `👤 ผู้ตรวจสอบ: ${data.receiverName}`;

      sendLineMessageAPI(lineMsg, 'COMPLETED');
  }

  return { success: true, message: "บันทึกการรับสินค้า (GR) สำเร็จ" };
}

// ฟังก์ชันสำหรับยิง LINE Messaging API รองรับ 2 บัญชี
function sendLineMessageAPI(textMessage, type = 'REVIEW') {
  let LINE_TOKEN = "";
  let GROUP_ID = "";

  if (type === 'REVIEW') {
      // 🟢 ตั้งค่ากลุ่มที่ 1 (กลุ่มสำหรับรอตรวจสอบ)
      LINE_TOKEN = "PjS0VKY0nWYKRa5hgDtaeG4+v9OsOWnL8EWf/Sy7uREbQedU9faxBsfnIk/USoeHR2oo/Td2uZre6KKMZoJprXaMPO9S+32/4kygylwbJA37jLctHhXxdyYXKarDuyxXHFlA+5CuWAHVNjH2JALvEgdB04t89/1O/w1cDnyilFU=";
      GROUP_ID = "C10ca0675dd394ffa482524ac95d8570a";
  } else if (type === 'COMPLETED') {
      // 🔵 ตั้งค่ากลุ่มที่ 2 (กลุ่มสำหรับแจ้งเตือนเมื่อรับเสร็จสมบูรณ์แล้ว)
      // เปลี่ยนตรงนี้ให้เป็น Token และ Group ID ของบอทตัวที่สอง
      LINE_TOKEN = "DAM4hAvhD8WbO/20n+NgznYh+NI92KeI7OiK0JBMw/OnlAbzeo0lLnxxUwGFZHWRW1scgfuIEYIMMfsFw2FuDP5FlV6uBBG1ODokCDOiwpDJOibO/NhjGSKPC5ynwMnhkhXfDsYbK19KNedLJ86hDgdB04t89/1O/w1cDnyilFU="; 
      GROUP_ID = "C32d9fc825945e0410e1ba1aabde5de40";
  }

  if (!LINE_TOKEN || !GROUP_ID) return;

  const url = "https://api.line.me/v2/bot/message/push";
  const payload = {
    to: GROUP_ID,
    messages: [{ type: "text", text: textMessage }]
  };
  
  const options = {
    method: "post",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + LINE_TOKEN
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();
    
    console.log(`LINE Messaging API (${type}) - Status: ${responseCode}`);
    if (responseCode !== 200) {
      console.log(`LINE Messaging API (${type}) - Error Body: ${responseBody}`);
    }
  } catch(e) {
    console.log(`LINE Messaging API (${type}) - Fetch Error: ${e.message}`);
  }
}

// ==========================================
// 7. จัดซื้อกระทบยอดและส่ง APV
// ==========================================
function closePO(data) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const trackingSheet = ss.getSheetByName('TrackingPO');
    
    if (!data.items || data.items.length === 0) {
      return { success: false, message: "ไม่มีรายการที่ต้องอัปเดต" };
    }

    data.items.forEach(item => {
      if (item.poNumber) {
        trackingSheet.getRange(item.rowNumber, 3).setValue(item.poNumber);
      }
      trackingSheet.getRange(item.rowNumber, 10).setValue(item.revisedGrQty);
      trackingSheet.getRange(item.rowNumber, 12).setValue("PO Closed - Ready for APV");
      
      if (item.matchRemark) {
        let currentRemark = trackingSheet.getRange(item.rowNumber, 14).getValue();
        let newRemark = currentRemark ? currentRemark + " | [Match]: " + item.matchRemark : "[Match]: " + item.matchRemark;
        trackingSheet.getRange(item.rowNumber, 14).setValue(newRemark);
      }
    });

    return { success: true, message: `บันทึกรายการทำจ่าย (APV) สำเร็จ จำนวน ${data.items.length} รายการ` };
  } catch (error) {
    return { success: false, message: "เกิดข้อผิดพลาดในการส่งทำใบตั้งหนี้ (APV)", errorDetail: error.toString() };
  }
}