interface Fetcher {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}
