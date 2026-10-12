type RequestOptions = {
  signal?: AbortSignal;
  errorMessage?: string;
};

export async function api<T = unknown>(
  path: string,
  method = 'GET',
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const response = await fetch('/api/' + path, {
    method,
    credentials: 'same-origin',
    signal: options.signal,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || options.errorMessage || 'No se pudo completar la operación.');
  }
  return data as T;
}
