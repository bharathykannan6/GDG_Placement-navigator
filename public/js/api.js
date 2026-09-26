// fetch wrapper: returns parsed JSON or throws an Error with a readable message.

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
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
