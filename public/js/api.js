// fetch wrapper: returns parsed JSON or throws an Error with a readable message.
// `body` is sent as JSON; `file` (a File/Blob) is sent as-is with its own type.

export async function api(path, { method = 'GET', body, file } = {}) {
  let headers;
  let payload;
  if (file) {
    headers = { 'Content-Type': file.type || 'application/octet-stream' };
    payload = file;
  } else if (body) {
    headers = { 'Content-Type': 'application/json' };
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON response; handled below
  }

  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status}).`);
  return data;
}
