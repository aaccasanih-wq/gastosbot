// =====================================================
// GASTOSBOT — Google Apps Script completo
// =====================================================

var LABEL_NAME = 'GastosBot-Procesado';
var BANK_SENDERS = [
  'notificaciones@notificacionesbcp.com.pe',
  'notificaciones@yape.pe',
  'servicioalcliente@netinterbank.com.pe'
];
var DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
var DEEPSEEK_MODEL = 'deepseek-chat';

// =====================================================
// HELPERS — CONFIGURACIÓN
// =====================================================

function getScriptProps() {
  return PropertiesService.getScriptProperties();
}

function getSpreadsheet() {
  return SpreadsheetApp.openById(getScriptProps().getProperty('SPREADSHEET_ID'));
}

function getConfigData() {
  var data = getSpreadsheet().getSheetByName('Config').getDataRange().getValues();
  var configs = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    configs.push({
      chat_id:      String(data[i][0]),
      usuario:      data[i][1],
      hoja:         data[i][2],
      email_sufijo: data[i][3]
    });
  }
  return configs;
}

function getFamiliarBySuffix(suffix) {
  var configs = getConfigData();
  for (var i = 0; i < configs.length; i++) {
    if (configs[i].email_sufijo.toLowerCase() === suffix.toLowerCase()) return configs[i];
  }
  return null;
}

function getFamiliarByChatId(chatId) {
  var configs = getConfigData();
  for (var i = 0; i < configs.length; i++) {
    if (configs[i].chat_id === String(chatId)) return configs[i];
  }
  return null;
}

// =====================================================
// HELPERS — DEEPSEEK
// =====================================================

function callDeepSeek(systemPrompt, userMessage) {
  var apiKey = getScriptProps().getProperty('DEEPSEEK_API_KEY');
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1
    }),
    muteHttpExceptions: true
  };
  var res = UrlFetchApp.fetch(DEEPSEEK_URL, options);
  var json = JSON.parse(res.getContentText());
  if (!json.choices || !json.choices[0]) {
    throw new Error('DeepSeek sin respuesta: ' + res.getContentText());
  }
  return JSON.parse(json.choices[0].message.content);
}

// =====================================================
// HELPERS — TELEGRAM
// =====================================================

function sendTelegram(chatId, text) {
  try {
    var token = getScriptProps().getProperty('TELEGRAM_TOKEN');
    UrlFetchApp.fetch(
      'https://api.telegram.org/bot' + token + '/sendMessage',
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ chat_id: chatId, text: text }),
        muteHttpExceptions: true
      }
    );
  } catch (e) {
    console.error('sendTelegram error: ' + e.message);
  }
}

// =====================================================
// HELPERS — SPREADSHEET
// =====================================================

function formatFecha(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, 'America/Lima', "yyyy-MM-dd'T'HH:mm:ss");
  }
  return String(value);
}

function generateId(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return '#0001';
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var maxNum = 0;
  for (var i = 0; i < ids.length; i++) {
    var match = String(ids[i][0]).match(/#(\d+)/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
  }
  var num = String(maxNum + 1);
  while (num.length < 4) num = '0' + num;
  return '#' + num;
}

function rowToRecord(row, rowIndex) {
  return {
    rowIndex:        rowIndex,
    id:              row[0],
    fecha_operacion: formatFecha(row[1]),
    pagador:         row[2],
    destinatario:    row[3],
    medio:           row[4],
    monto:           row[5],
    descripcion:     row[6],
    concepto:        row[7],
    fuente:          row[8],
    gmail_id:        row[9]
  };
}

function getAllRecords(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var records = [];
  for (var i = 0; i < values.length; i++) {
    records.push(rowToRecord(values[i], i + 2));
  }
  return records;
}

function getRecentRecords(sheet, n) {
  var all = getAllRecords(sheet);
  var start = Math.max(0, all.length - n);
  var result = all.slice(start);
  result.reverse();
  return result;
}

function findRecordById(sheet, recordId) {
  var all = getAllRecords(sheet);
  for (var i = 0; i < all.length; i++) {
    if (all[i].id === recordId) return all[i];
  }
  return null;
}

function gmailIdExists(sheet, gmailId) {
  if (!gmailId) return false;
  var all = getAllRecords(sheet);
  for (var i = 0; i < all.length; i++) {
    if (all[i].gmail_id === gmailId) return true;
  }
  return false;
}

function filterByRange(records, startDate, endDate) {
  if (!startDate && !endDate) return records;
  var start = startDate ? new Date(startDate + 'T00:00:00') : null;
  var end   = endDate   ? new Date(endDate   + 'T23:59:59') : null;
  var result = [];
  for (var i = 0; i < records.length; i++) {
    var d = new Date(records[i].fecha_operacion);
    if (start && d < start) continue;
    if (end   && d > end)   continue;
    result.push(records[i]);
  }
  return result;
}

function searchRecordsByCriteria(sheet, params) {
  var all = getAllRecords(sheet);
  var results = [];
  for (var i = 0; i < all.length; i++) {
    var r = all[i];
    if (params.start_date || params.end_date) {
      var d = new Date(r.fecha_operacion);
      if (params.start_date && d < new Date(params.start_date)) continue;
      if (params.end_date   && d > new Date(params.end_date))   continue;
    }
    if (params.destinatario && String(r.destinatario).toLowerCase().indexOf(String(params.destinatario).toLowerCase()) === -1) continue;
    if (params.concepto && r.concepto !== params.concepto) continue;
    if (params.medio    && r.medio    !== params.medio)    continue;
    if (params.monto    && parseFloat(r.monto) !== parseFloat(params.monto)) continue;
    results.push(r);
  }
  return results;
}

function appendRecord(sheet, record) {
  sheet.appendRow([
    record.id,
    record.fecha_operacion,
    record.pagador,
    record.destinatario,
    record.medio,
    record.monto,
    record.descripcion,
    record.concepto,
    record.fuente,
    record.gmail_id || ''
  ]);
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function transcribeVoice(fileId) {
  var token   = getScriptProps().getProperty('TELEGRAM_TOKEN');
  var groqKey = getScriptProps().getProperty('GROQ_API_KEY');

  // Obtener la ruta del archivo en Telegram
  var fileRes  = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/getFile?file_id=' + fileId,
    { muteHttpExceptions: true }
  );
  var fileJson = JSON.parse(fileRes.getContentText());
  if (!fileJson.ok) throw new Error('getFile error: ' + fileRes.getContentText());
  var filePath = fileJson.result.file_path;

  // Descargar el audio como blob
  var audioBlob = UrlFetchApp.fetch(
    'https://api.telegram.org/file/bot' + token + '/' + filePath,
    { muteHttpExceptions: true }
  ).getBlob().setName('audio.ogg').setContentType('audio/ogg');

  // Construir cuerpo multipart manualmente
  var boundary = 'GASBoundary' + String(new Date().getTime());
  var CRLF = '\r\n';
  var pre = '--' + boundary + CRLF +
    'Content-Disposition: form-data; name="model"' + CRLF + CRLF +
    'whisper-large-v3-turbo' + CRLF +
    '--' + boundary + CRLF +
    'Content-Disposition: form-data; name="language"' + CRLF + CRLF +
    'es' + CRLF +
    '--' + boundary + CRLF +
    'Content-Disposition: form-data; name="response_format"' + CRLF + CRLF +
    'text' + CRLF +
    '--' + boundary + CRLF +
    'Content-Disposition: form-data; name="file"; filename="audio.ogg"' + CRLF +
    'Content-Type: audio/ogg' + CRLF + CRLF;
  var post = CRLF + '--' + boundary + '--' + CRLF;

  var bodyBytes = Utilities.newBlob(pre).getBytes()
    .concat(audioBlob.getBytes())
    .concat(Utilities.newBlob(post).getBytes());

  // Llamar a Groq Whisper
  var res = UrlFetchApp.fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'post',
    headers: {
      'Authorization': 'Bearer ' + groqKey,
      'Content-Type': 'multipart/form-data; boundary=' + boundary
    },
    payload: bodyBytes,
    muteHttpExceptions: true
  });

  var transcription = res.getContentText().trim();
  if (!transcription) throw new Error('Groq sin transcripcion: ' + res.getContentText());
  return transcription;
}

// =====================================================
// TRIGGER 1 — CORREOS BANCARIOS (corre cada 1 minuto)
// =====================================================

function checkEmails() {
  var label = getOrCreateLabel(LABEL_NAME);
  var senderQ = '';
  for (var i = 0; i < BANK_SENDERS.length; i++) {
    if (i > 0) senderQ += ' OR ';
    senderQ += 'from:' + BANK_SENDERS[i];
  }
  var threads = GmailApp.search('(' + senderQ + ') -label:' + LABEL_NAME + ' newer_than:1d', 0, 20);
  if (!threads.length) return;

  var ss = getSpreadsheet();
  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      processEmailMessage(messages[m], ss, label);
    }
  }
}

function processEmailMessage(message, ss, label) {
  try {
    var rawContent = message.getRawContent();
    var familiar = identifyFamiliarFromRaw(rawContent);

    if (!familiar) {
      console.log('Familiar no identificado para mensaje: ' + message.getId());
      message.markRead();
      message.getThread().addLabel(label);
      return;
    }

    var sheet = ss.getSheetByName(familiar.hoja);
    if (!sheet) {
      console.error('Hoja no encontrada: ' + familiar.hoja);
      return;
    }

    var emailData = extractEmailData(message);
    if (!emailData) {
      console.error('No se pudo extraer datos del correo: ' + message.getId());
      return;
    }

    var gmailId = message.getId();
    if (gmailIdExists(sheet, gmailId)) {
      message.getThread().addLabel(label);
      return;
    }

    var record = {
      id:              generateId(sheet),
      fecha_operacion: emailData.fecha_operacion,
      pagador:          emailData.pagador,
      destinatario:    emailData.destinatario,
      medio:           emailData.medio,
      monto:           emailData.monto,
      descripcion:     emailData.descripcion,
      concepto:        emailData.concepto,
      fuente:          'gmail',
      gmail_id:        gmailId
    };

    appendRecord(sheet, record);
    sendTelegram(familiar.chat_id, formatNewRecordMsg(record));

    message.markRead();
    message.getThread().addLabel(label);

  } catch (e) {
    console.error('Error procesando correo ' + message.getId() + ': ' + e.message);
  }
}

function identifyFamiliarFromRaw(rawContent) {
  var configs = getConfigData();

  // Emails reenviados con sufijo: gastos.familia.hub+axel@gmail.com
  var regexSufijo = /Delivered-To:\s*gastos\.familia\.hub(\+[a-z]+)@gmail\.com/gi;
  var match;
  while ((match = regexSufijo.exec(rawContent)) !== null) {
    for (var i = 0; i < configs.length; i++) {
      if (configs[i].email_sufijo.toLowerCase() === match[1].toLowerCase()) {
        return configs[i];
      }
    }
  }

  // Emails directos sin sufijo: gastos.familia.hub@gmail.com → familiar con email_sufijo vacío
  if (/Delivered-To:\s*gastos\.familia\.hub@gmail\.com/i.test(rawContent)) {
    for (var j = 0; j < configs.length; j++) {
      if (configs[j].email_sufijo === '') return configs[j];
    }
  }

  return null;
}

function extractEmailData(message) {
  var systemPrompt = 'Eres un extractor de datos de correos bancarios peruanos.\n' +
    'Extrae los datos y devuelve JSON con exactamente estos campos:\n' +
    '- fecha_operacion: string ISO "YYYY-MM-DDTHH:MM:SS"\n' +
    '- pagador: nombre del dueno de la cuenta\n' +
    '- destinatario: a quien fue el dinero\n' +
    '- medio: exactamente uno de: "Yape", "Tarjeta Debito BCP", "Tarjeta Credito BCP", "Interbank", "Efectivo"\n' +
    '- monto: numero decimal (ej: 15.00)\n' +
    '- descripcion: nota del pagador o "" si no hay\n' +
    '- concepto: exactamente uno de: "comida", "transporte", "servicios", "entretenimiento", "salud", "educacion", "ropa", "prestamos", "pago de prestamos", "tecnologia", "hogar", "otro"\n\n' +
    'Regla BCP: asunto con "debito" o "cargo" => "Tarjeta Debito BCP"; "credito" => "Tarjeta Credito BCP".\n' +
    'Regla Yape: remitente notificaciones@yape.pe => "Yape".\n' +
    'Devuelve SOLO el JSON.';

  var userMsg = 'Remitente: ' + message.getFrom() + '\n' +
    'Asunto: ' + message.getSubject() + '\n' +
    'Cuerpo:\n' + message.getPlainBody().substring(0, 3000);

  try {
    return callDeepSeek(systemPrompt, userMsg);
  } catch (e) {
    console.error('DeepSeek extraccion error: ' + e.message);
    return null;
  }
}

function formatNewRecordMsg(record) {
  return 'Nuevo gasto registrado\n' +
    'ID: ' + record.id + '\n' +
    'Fecha: ' + record.fecha_operacion + '\n' +
    'Emisor: ' + record.pagador + '\n' +
    'Beneficiario: ' + record.destinatario + '\n' +
    'Medio: ' + record.medio + '\n' +
    'Monto: S/ ' + record.monto + '\n' +
    'Descripcion: ' + (record.descripcion || '-') + '\n' +
    'Concepto: ' + record.concepto + '\n' +
    'Fuente: ' + record.fuente;
}

// =====================================================
// TRIGGER 2 — POLLING TELEGRAM (corre cada 1 minuto)
// =====================================================

function pollTelegram() {
  var props = getScriptProps();
  var token = props.getProperty('TELEGRAM_TOKEN');
  var lastId = parseInt(props.getProperty('TELEGRAM_LAST_UPDATE_ID') || '0');

  var url = 'https://api.telegram.org/bot' + token +
    '/getUpdates?offset=' + (lastId + 1) + '&limit=100&timeout=0';
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var json = JSON.parse(res.getContentText());

  if (!json.ok || !json.result || !json.result.length) return;

  for (var i = 0; i < json.result.length; i++) {
    var update = json.result[i];
    try {
      processTelegramUpdate(update);
    } catch (e) {
      console.error('pollTelegram error en update ' + update.update_id + ': ' + e.message);
    }
    if (update.update_id > lastId) lastId = update.update_id;
  }

  props.setProperty('TELEGRAM_LAST_UPDATE_ID', String(lastId));
}

function setupPollingTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'pollTelegram') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('pollTelegram').timeBased().everyMinutes(1).create();
  console.log('Trigger de polling creado. Bot activo.');
}

function deleteWebhookAndStartPolling() {
  var token = getScriptProps().getProperty('TELEGRAM_TOKEN');
  var res = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/deleteWebhook?drop_pending_updates=true',
    { muteHttpExceptions: true }
  );
  console.log('deleteWebhook: ' + res.getContentText());
  setupPollingTrigger();
}

function diagnosticarScript() {
  console.log('Usuario activo: ' + Session.getActiveUser().getEmail());
  console.log('Usuario efectivo: ' + Session.getEffectiveUser().getEmail());

  var senderQ = '';
  for (var i = 0; i < BANK_SENDERS.length; i++) {
    if (i > 0) senderQ += ' OR ';
    senderQ += 'from:' + BANK_SENDERS[i];
  }
  var threads = GmailApp.search('(' + senderQ + ')', 0, 5);
  console.log('Correos bancarios encontrados (ultimos 5): ' + threads.length);
  for (var t = 0; t < threads.length; t++) {
    var msg = threads[t].getMessages()[0];
    console.log('  - De: ' + msg.getFrom() + ' | Leido: ' + !msg.isUnread() + ' | ID: ' + msg.getId());
    var raw = msg.getRawContent();
    var match = raw.match(/Delivered-To:[^\n]+/i);
    console.log('    Delivered-To: ' + (match ? match[0] : 'no encontrado'));
  }
}

function setupAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('checkEmails').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('pollTelegram').timeBased().everyMinutes(1).create();
  console.log('Triggers recreados: checkEmails + pollTelegram cada 1 minuto.');
}

function doPost(e) {
  try {
    var update = JSON.parse(e.postData.contents);
    processTelegramUpdate(update);
  } catch (err) {
    try {
      var upd = JSON.parse(e.postData.contents);
      var msg = upd.message || upd.edited_message;
      if (msg && msg.chat && msg.chat.id) {
        sendTelegram(String(msg.chat.id), 'Error: ' + String(err));
      }
    } catch (e2) {}
  }
  return ContentService.createTextOutput('OK');
}

function processTelegramUpdate(update) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'v3_' + String(update.update_id);
  if (cache.get(cacheKey)) return;

  var message = update.message || update.edited_message;
  if (!message) return;

  var chatId = String(message.chat.id);
  var text = null;

  if (message.text) {
    text = message.text;
  } else if (message.voice) {
    try {
      text = transcribeVoice(message.voice.file_id);
    } catch (e) {
      console.error('transcribeVoice error: ' + e.message);
      sendTelegram(chatId, 'No pude transcribir el audio. Intenta de nuevo o escribe tu mensaje.');
      cache.put(cacheKey, '1', 3600);
      return;
    }
  } else {
    return;
  }

  var familiar = getFamiliarByChatId(chatId);
  if (!familiar) {
    sendTelegram(chatId, 'Tu chat ID no esta registrado. Comparte este numero: ' + chatId);
    cache.put(cacheKey, '1', 3600);
    return;
  }

  var sheet = getSpreadsheet().getSheetByName(familiar.hoja);
  var recent = getRecentRecords(sheet, 5);
  var context = recent.length ? JSON.stringify(recent) : '(sin registros aun)';

  var intent = detectIntent(text, context, familiar.usuario);
  if (!intent) {
    sendTelegram(chatId, 'No entendi tu mensaje. Intenta de nuevo.');
    cache.put(cacheKey, '1', 3600);
    return;
  }

  executeAction(intent, familiar, sheet, chatId);
  cache.put(cacheKey, '1', 3600);
}

function detectIntent(userMessage, recentRecordsJson, usuario) {
  var today = Utilities.formatDate(new Date(), 'America/Lima', "yyyy-MM-dd'T'HH:mm:ss");
  var systemPrompt = 'Eres el asistente de GastosBot para ' + usuario + '. Hoy es ' + today + '.\n' +
    'Analiza el mensaje y devuelve JSON con exactamente estos campos:\n' +
    '- action: exactamente uno de: "add_cash", "edit_record", "confirm", "get_last", "get_by_range", "get_total", "delete_record", "get_total_by"\n' +
    '- params: objeto con los parametros requeridos segun la accion\n' +
    '- reply: texto de respuesta en espanol, sin markdown ni HTML\n\n' +
    'Parametros por accion:\n' +
    '  add_cash:       {destinatario, monto, descripcion, concepto}\n' +
    '  edit_record:    {record_id?, start_date?, end_date?, destinatario?, concepto?, medio?, monto?, field, new_value}\n' +
    '    Usa record_id si lo conoces del contexto; si no, describe el registro con criterios de busqueda.\n' +
    '  confirm:        {}\n' +
    '  get_last:       {n}\n' +
    '  get_by_range:   {start_date: "YYYY-MM-DD", end_date: "YYYY-MM-DD"}\n' +
    '  get_total:      {start_date?: "YYYY-MM-DD", end_date?: "YYYY-MM-DD"}\n' +
    '  delete_record:  {record_id?, start_date?, end_date?, destinatario?, concepto?, medio?, monto?}\n' +
    '    Usa record_id si lo conoces del contexto; si no, describe el registro con criterios de busqueda.\n' +
    '  get_total_by:   {category?, medio?, start_date?: "YYYY-MM-DD", end_date?: "YYYY-MM-DD"}\n' +
    '    Usa category para filtrar por categoria, medio para filtrar por medio de pago, o ambos.\n\n' +
    'Conceptos validos: "comida","transporte","servicios","entretenimiento","salud","educacion","ropa","prestamos","pago de prestamos","tecnologia","hogar","otro"\n' +
    'Medios validos: "Yape","Tarjeta Debito BCP","Tarjeta Credito BCP","Interbank","Efectivo"\n' +
    'Devuelve SOLO el JSON.';

  try {
    return callDeepSeek(systemPrompt, 'Mensaje: ' + userMessage + '\n\nUltimos registros:\n' + recentRecordsJson);
  } catch (e) {
    console.error('detectIntent error: ' + e.message);
    return null;
  }
}

// =====================================================
// DISPATCHER DE ACCIONES
// =====================================================

function executeAction(intent, familiar, sheet, chatId) {
  var action = intent.action;
  var params = intent.params;
  var reply  = intent.reply;

  if (action === 'add_cash')       handleAddCash(params, familiar, sheet, chatId, reply);
  else if (action === 'edit_record')    handleEditRecord(params, sheet, chatId, reply);
  else if (action === 'confirm')        sendTelegram(chatId, reply || 'Confirmado.');
  else if (action === 'get_last')       handleGetLast(params, sheet, chatId);
  else if (action === 'get_by_range')   handleGetByRange(params, sheet, chatId);
  else if (action === 'get_total')      handleGetTotal(params, sheet, chatId);
  else if (action === 'delete_record')  handleDeleteRecord(params, sheet, chatId, reply);
  else if (action === 'get_total_by')    handleGetTotalBy(params, sheet, chatId);
  else sendTelegram(chatId, reply || 'Accion no reconocida: ' + action);
}

// =====================================================
// MANEJADORES DE ACCIONES
// =====================================================

function handleAddCash(params, familiar, sheet, chatId, aiReply) {
  var fecha = Utilities.formatDate(new Date(), 'America/Lima', "yyyy-MM-dd'T'HH:mm:ss");
  var record = {
    id:              generateId(sheet),
    fecha_operacion: fecha,
    pagador:          familiar.usuario,
    destinatario:    params.destinatario || '',
    medio:           'Efectivo',
    monto:           parseFloat(params.monto) || 0,
    descripcion:     params.descripcion || '',
    concepto:        params.concepto || 'otro',
    fuente:          'telegram',
    gmail_id:        ''
  };
  appendRecord(sheet, record);
  var msg = (aiReply ? aiReply + '\n\n' : '') + formatNewRecordMsg(record);
  sendTelegram(chatId, msg);
}

function handleEditRecord(params, sheet, chatId, aiReply) {
  var record = null;

  if (params.record_id) {
    record = findRecordById(sheet, params.record_id);
    if (!record) {
      sendTelegram(chatId, 'No encontre el registro ' + params.record_id);
      return;
    }
  } else {
    var found = searchRecordsByCriteria(sheet, params);
    if (!found.length) {
      sendTelegram(chatId, 'No encontre ningun registro con esos criterios.');
      return;
    }
    if (found.length > 1) {
      var lines = ['Encontre varios registros que coinciden. Indica el ID del que deseas editar:\n'];
      for (var i = 0; i < found.length; i++) {
        var r = found[i];
        lines.push(r.id + ' | ' + String(r.fecha_operacion).substring(0, 16) + ' | ' + r.destinatario + ' | S/ ' + r.monto + ' | ' + r.concepto);
      }
      sendTelegram(chatId, lines.join('\n'));
      return;
    }
    record = found[0];
  }

  var colMap = {
    fecha_operacion: 2,
    pagador:          3,
    destinatario:    4,
    medio:           5,
    monto:           6,
    descripcion:     7,
    concepto:        8,
    fuente:          9,
    gmail_id:        10
  };
  var col = colMap[params.field];
  if (!col) {
    sendTelegram(chatId, 'Campo no valido: ' + params.field);
    return;
  }

  var oldValue = record[params.field];
  sheet.getRange(record.rowIndex, col).setValue(params.new_value);

  var msg = aiReply || ('Registro ' + record.id + ' actualizado\nCampo: ' + params.field + '\nAntes: ' + oldValue + '\nAhora: ' + params.new_value);
  sendTelegram(chatId, msg);
}

function handleGetLast(params, sheet, chatId) {
  var n = parseInt(params.n) || 5;
  var records = getRecentRecords(sheet, n);
  if (!records.length) {
    sendTelegram(chatId, 'No hay registros todavia.');
    return;
  }
  var lines = [];
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    lines.push(r.id + ' | ' + String(r.fecha_operacion).substring(0, 10) + ' | ' + r.destinatario + ' | S/ ' + r.monto + ' | ' + r.concepto);
  }
  sendTelegram(chatId, 'Ultimos ' + records.length + ' registros:\n\n' + lines.join('\n'));
}

function handleGetByRange(params, sheet, chatId) {
  var all = getAllRecords(sheet);
  var records = filterByRange(all, params.start_date, params.end_date);
  if (!records.length) {
    sendTelegram(chatId, 'No hay registros en ese rango de fechas.');
    return;
  }
  var lines = [];
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    lines.push(r.id + ' | ' + String(r.fecha_operacion).substring(0, 10) + ' | ' + r.destinatario + ' | S/ ' + r.monto + ' | ' + r.concepto);
  }
  var label = params.start_date === params.end_date
    ? params.start_date
    : (params.start_date || '?') + ' al ' + (params.end_date || '?');
  sendTelegram(chatId, 'Registros del ' + label + ':\n\n' + lines.join('\n'));
}

function handleGetTotal(params, sheet, chatId) {
  var all = getAllRecords(sheet);
  var records = filterByRange(all, params.start_date, params.end_date);
  var total = 0;
  for (var i = 0; i < records.length; i++) {
    total += parseFloat(records[i].monto || 0);
  }
  var label = (!params.start_date && !params.end_date)
    ? 'total historico'
    : params.start_date === params.end_date
      ? params.start_date
      : (params.start_date || 'inicio') + ' al ' + (params.end_date || 'hoy');
  sendTelegram(chatId, 'Total gastado (' + label + '): S/ ' + total.toFixed(2) + ' (' + records.length + ' registros)');
}

function handleDeleteRecord(params, sheet, chatId, aiReply) {
  if (params.record_id) {
    var record = findRecordById(sheet, params.record_id);
    if (!record) {
      sendTelegram(chatId, 'No encontre el registro ' + params.record_id);
      return;
    }
    sheet.deleteRow(record.rowIndex);
    sendTelegram(chatId, aiReply || ('Registro ' + params.record_id + ' eliminado.'));
    return;
  }

  var found = searchRecordsByCriteria(sheet, params);
  if (!found.length) {
    sendTelegram(chatId, 'No encontre ningun registro con esos criterios.');
    return;
  }
  if (found.length === 1) {
    var r = found[0];
    sheet.deleteRow(r.rowIndex);
    sendTelegram(chatId, aiReply || ('Registro ' + r.id + ' eliminado.\n' + r.destinatario + ' | S/ ' + r.monto + ' | ' + r.concepto));
    return;
  }
  var lines = ['Encontre varios registros que coinciden. Indica el ID del que deseas eliminar:\n'];
  for (var i = 0; i < found.length; i++) {
    var rf = found[i];
    lines.push(rf.id + ' | ' + String(rf.fecha_operacion).substring(0, 16) + ' | ' + rf.destinatario + ' | S/ ' + rf.monto + ' | ' + rf.concepto);
  }
  sendTelegram(chatId, lines.join('\n'));
}

function handleGetTotalBy(params, sheet, chatId) {
  var all = getAllRecords(sheet);
  var records = filterByRange(all, params.start_date, params.end_date);
  var total = 0;
  var count = 0;
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (params.category && r.concepto !== params.category) continue;
    if (params.medio    && r.medio    !== params.medio)    continue;
    total += parseFloat(r.monto || 0);
    count++;
  }
  var filtros = [];
  if (params.category) filtros.push('categoria "' + params.category + '"');
  if (params.medio)    filtros.push('medio "' + params.medio + '"');
  var periodo = (params.start_date || params.end_date)
    ? ' (' + (params.start_date || 'inicio') + ' al ' + (params.end_date || 'hoy') + ')'
    : ' (total historico)';
  sendTelegram(chatId, 'Total en ' + filtros.join(' + ') + periodo + ': S/ ' + total.toFixed(2) + ' (' + count + ' registros)');
}
