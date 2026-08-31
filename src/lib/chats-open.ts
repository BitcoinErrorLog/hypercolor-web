const STORAGE_KEY = "hc-chats-open";

let chatsRequested = false;

function readStored(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStored(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.sessionStorage.setItem(STORAGE_KEY, "1");
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode still keeps the in-memory flag for this document.
  }
}

function writeDataset(on: boolean): void {
  if (typeof document === "undefined") return;
  if (on) document.documentElement.dataset.hcChatsOpen = "1";
  else delete document.documentElement.dataset.hcChatsOpen;
}

export function isChatsRequested(): boolean {
  return chatsRequested || readStored();
}

export function markChatsRequested(): void {
  chatsRequested = true;
  writeStored(true);
  writeDataset(true);
}

export function clearChatsRequested(): void {
  chatsRequested = false;
  writeStored(false);
  writeDataset(false);
}
