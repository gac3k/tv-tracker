import { extApi, normalizeApiUrl, originPattern, type MsgResult, type Settings } from "./shared.js";

const ext = extApi();
const form = document.querySelector("#form") as HTMLFormElement;
const apiUrl = document.querySelector("#apiUrl") as HTMLInputElement;
const token = document.querySelector("#token") as HTMLInputElement;
const status = document.querySelector("#status") as HTMLParagraphElement;

function setStatus(text: string, kind: "ok" | "bad" | "") {
  status.textContent = text;
  status.dataset.kind = kind;
}

async function persist(settings: Settings): Promise<void> {
  setStatus("Checking API…", "");
  const result = (await ext.runtime.sendMessage({
    type: "saveSettings",
    settings,
  })) as MsgResult<Settings>;
  if (!result.ok) {
    setStatus(result.error, "bad");
    return;
  }
  apiUrl.value = result.value.apiUrl;
  setStatus("Saved.", "ok");
}

const loaded = (await ext.runtime.sendMessage({ type: "getSettings" })) as MsgResult<Settings | null>;
if (loaded.ok && loaded.value) {
  apiUrl.value = loaded.value.apiUrl;
  token.value = loaded.value.token;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  let origin: string;
  try {
    origin = originPattern(normalizeApiUrl(apiUrl.value));
  } catch {
    setStatus("API URL must be http or https", "bad");
    return;
  }
  // Firefox drops the user-gesture if anything is awaited before request().
  void ext.permissions.request({ origins: [origin] }).then((granted) => {
    if (!granted) {
      setStatus("Permission to reach the API was denied", "bad");
      return;
    }
    return persist({ apiUrl: apiUrl.value, token: token.value });
  });
});
