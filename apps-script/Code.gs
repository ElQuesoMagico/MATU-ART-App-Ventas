// Server-only project. Never include this directory in the Vite build.
// doPost does not expose arbitrary HTTP headers: authenticate the exact payload.
function doGet() { return output_({version:1,ok:false,error:{code:'UNAUTHORIZED'}}); }
function doPost(e) {
  var requestId;
  try {
    if (!e || !e.postData || e.postData.type !== 'application/json' || e.postData.contents.length > 4096) throw new Error();
    var envelope = JSON.parse(e.postData.contents);
    if (Object.keys(envelope).sort().join(',') !== 'keyId,payload,signature' || typeof envelope.payload !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(envelope.keyId) || !/^[a-f0-9]{64}$/.test(envelope.signature)) throw new Error();
    var props = PropertiesService.getScriptProperties();
    var keys = JSON.parse(props.getProperty('GATEWAY_KEYS') || '{}');
    var secret = keys[envelope.keyId];
    if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) throw new Error();
    var expected = Utilities.computeHmacSha256Signature(envelope.keyId + '\n' + envelope.payload, secret, Utilities.Charset.UTF_8).map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    var difference = 0;
    for (var i=0;i<64;i++) difference |= expected.charCodeAt(i) ^ envelope.signature.charCodeAt(i);
    if (difference !== 0) throw new Error();
    var input = JSON.parse(envelope.payload), now = Date.now();
    if (Object.keys(input).sort().join(',') !== 'operation,requestId,timestamp,version' || input.version !== 1 || !/^[a-f0-9-]{36}$/.test(input.requestId) || !Number.isSafeInteger(input.timestamp) || Math.abs(now-input.timestamp)>60000 || !['ping','metadata'].includes(input.operation)) throw new Error();
    // Properties + lock, not CacheService (which may evict replay protection).
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) throw new Error();
    try {
      var seen = props.getProperties(), count = 0;
      Object.keys(seen).filter(function(k) { return k.indexOf('nonce:') === 0; }).forEach(function(k) {
        if (Number(seen[k]) <= now) props.deleteProperty(k); else count++;
      });
      var nonce = 'nonce:' + input.requestId;
      if (props.getProperty(nonce) || count >= 200) throw new Error();
      props.setProperty(nonce,String(now+125000));
    } finally { lock.releaseLock(); }
    requestId = input.requestId;
    var ready = true;
    if (input.operation === 'metadata') {
      var book = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
      ready = REQUIRED_TABLES.every(function(name) {
        var sheet = book.getSheetByName(name);
        return sheet && JSON.stringify(sheet.getRange(1,1,1,COMMON_HEADERS.length).getValues()[0]) === JSON.stringify(COMMON_HEADERS);
      });
    }
    return output_({version:1,requestId:requestId,ok:true,data:{schemaVersion:1,ready:ready}});
  } catch (_) {
    // ContentService cannot choose arbitrary HTTP statuses. Worker validates ok.
    return output_({version:1,requestId:requestId,ok:false,error:{code:'REQUEST_REJECTED'}});
  }
}
var COMMON_HEADERS = ['id','workspaceId','revision','updatedAt','operationId','payloadJson'];
var REQUIRED_TABLES = ['products','categories','families','ips','promotions','events','sales','payments','movements','costChanges','expenses','expenseCategories','expenseChanges','syncOperations','audit'];
function output_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
