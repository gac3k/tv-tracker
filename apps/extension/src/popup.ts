import { extApi, type MsgResult, type Provider, type Settings } from "./shared.js";

const ext = extApi();
const status = document.querySelector("#status") as HTMLParagraphElement;
const list = document.querySelector("#list") as HTMLUListElement;
const options = document.querySelector("#options") as HTMLButtonElement;

options.addEventListener("click", () => {
  void ext.runtime.openOptionsPage();
});

function setStatus(text: string, kind: "ok" | "bad" | "" = "") {
  status.textContent = text;
  status.dataset.kind = kind;
}

const settings = (await ext.runtime.sendMessage({ type: "getSettings" })) as MsgResult<Settings | null>;
if (!settings.ok) {
  setStatus(settings.error, "bad");
} else if (!settings.value) {
  setStatus("Set the API URL and token in Options first.", "bad");
} else {
  const providers = (await ext.runtime.sendMessage({ type: "listProviders" })) as MsgResult<Provider[]>;
  if (!providers.ok) {
    setStatus(providers.error, "bad");
  } else if (providers.value.length === 0) {
    setStatus("No browser-session providers on this API.", "bad");
  } else {
    setStatus(`API ${settings.value.apiUrl}`);
    for (const provider of providers.value) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = provider.label;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Save session";
      button.addEventListener("click", () => {
        void (async () => {
          button.disabled = true;
          setStatus(`Saving ${provider.label}…`);
          const result = (await ext.runtime.sendMessage({
            type: "saveSession",
            provider: provider.id,
            domains: provider.cookieDomains,
          })) as MsgResult<number>;
          button.disabled = false;
          if (!result.ok) {
            setStatus(result.error, "bad");
            return;
          }
          setStatus(`Saved ${result.value} cookies for ${provider.label}. Sync to use them.`, "ok");
        })();
      });
      item.append(name, button);
      list.append(item);
    }
  }
}
