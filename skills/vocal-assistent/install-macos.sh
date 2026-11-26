#!/bin/bash
# VOCAL-ASSISTENT: instala esta versão personalizada do Handy num Mac (Apple Silicon).
#
# O que faz, em ordem (pode rodar de novo quantas vezes quiser; pula o que já existe):
#   1. Confere o Mac (Apple Silicon, memória, espaço, Command Line Tools)
#   2. Instala as ferramentas de compilação: Rust, Bun, CMake
#   3. Instala o Ollama e baixa o modelo gemma4:e4b (IA local que corrige/traduz)
#   4. Compila o Handy deste repositório e instala em /Applications
#   5. Baixa o modelo de voz Whisper Turbo (com verificação de hash)
#   6. Aplica as configurações de profile.json (atalhos, prompt, idiomas...)
#   7. Coloca Handy e Ollama para abrir junto com o Mac
#
# Uso:  bash vocal-assistent/install-macos.sh
# Nunca pede senha. Ao final, a pessoa precisa liberar Acessibilidade e Microfone.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HANDY_TAG=v0.10.2
PATCH="$HERE/patches/handy-$HANDY_TAG-custom.patch"
# Código do Handy: se esta pasta está dentro do projeto completo, usa ele;
# senão (ex.: veio do repositório de skills), baixa o Handy oficial e aplica o patch.
if [ -d "$HERE/../src-tauri" ]; then
  REPO="$(cd "$HERE/.." && pwd)"
else
  REPO="$HOME/.vocal-assistent/Handy-$HANDY_TAG"
fi
APP=/Applications/Handy.app
BUNDLE_ID=com.pais.handy
DATA="$HOME/Library/Application Support/$BUNDLE_ID"
SETTINGS="$DATA/settings_store.json"
OLLAMA_MODEL="$(python3 -c "import json;print(json.load(open('$HERE/profile.json'))['post_process_models']['custom'])")"
WHISPER_FILE=ggml-large-v3-turbo.bin
WHISPER_URL=https://blob.handy.computer/ggml-large-v3-turbo.bin
WHISPER_SHA=1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69
OLLAMA_TEAM=3MU9H2V9Y9   # assinatura oficial do Ollama.app

export PATH="$HOME/.local/cmake-venv/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mERRO:\033[0m %s\n' "$*"; exit 1; }

quit_handy() {
  osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  sleep 3
  pkill -f "$APP/Contents/MacOS" >/dev/null 2>&1 || true
  sleep 1
}

# ---------------------------------------------------------------- 1. Mac
step "1/7 Conferindo o Mac"
[ "$(uname -s)" = Darwin ] || die "Este instalador é só para macOS."
[ "$(uname -m)" = arm64 ] || die "Precisa de um Mac com Apple Silicon (M1 ou mais novo)."
ram_gb=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
[ "$ram_gb" -ge 16 ] && ok "Memória: ${ram_gb} GB" || warn "Memória: ${ram_gb} GB. Recomendado 16 GB; com menos pode ficar lento."
free_gb=$(df -g "$HOME" | awk 'NR==2{print $4}')
[ "$free_gb" -ge 20 ] || die "Pouco espaço livre (${free_gb} GB). Precisa de uns 20 GB."
ok "Espaço livre: ${free_gb} GB"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  die "Instale as Command Line Tools na janela que abriu e rode este script de novo."
fi
ok "Command Line Tools instaladas"
command -v python3 >/dev/null || die "python3 não encontrado (vem com as Command Line Tools)."

# ---------------------------------------------------------------- 2. ferramentas
step "2/7 Ferramentas de compilação"
if ! command -v cargo >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi
ok "Rust $(rustc --version | awk '{print $2}')"
if ! command -v bun >/dev/null; then
  curl -fsSL https://bun.sh/install | bash
fi
ok "Bun $(bun --version)"
if ! command -v cmake >/dev/null; then
  python3 -m venv "$HOME/.local/cmake-venv"
  "$HOME/.local/cmake-venv/bin/pip" install -q cmake
fi
ok "CMake $(cmake --version | head -1 | awk '{print $3}')"

# ---------------------------------------------------------------- 3. Ollama
step "3/7 Ollama + modelo $OLLAMA_MODEL"
if [ ! -d /Applications/Ollama.app ]; then
  url=$(curl -s https://api.github.com/repos/ollama/ollama/releases/latest \
    | python3 -c "import json,sys;print([a['browser_download_url'] for a in json.load(sys.stdin)['assets'] if a['name']=='Ollama-darwin.zip'][0])")
  tmp=$(mktemp -d)
  curl -sSL -o "$tmp/Ollama.zip" "$url"
  ditto -x -k "$tmp/Ollama.zip" "$tmp/x"
  team=$(codesign -dv "$tmp/x/Ollama.app" 2>&1 | awk -F= '/TeamIdentifier/{print $2}')
  [ "$team" = "$OLLAMA_TEAM" ] || { rm -rf "$tmp"; die "Assinatura do Ollama inesperada ($team). Abortei."; }
  cp -R "$tmp/x/Ollama.app" /Applications/
  rm -rf "$tmp"
fi
ok "Ollama instalado"
pgrep -f "Ollama.app" >/dev/null || open -g /Applications/Ollama.app
for _ in $(seq 1 30); do curl -s localhost:11434/api/version >/dev/null && break; sleep 1; done
curl -s localhost:11434/api/version >/dev/null || die "O Ollama não respondeu em localhost:11434."
/Applications/Ollama.app/Contents/Resources/ollama pull "$OLLAMA_MODEL"
ok "Modelo $OLLAMA_MODEL pronto"

# ---------------------------------------------------------------- 4. Handy
step "4/7 Compilando o Handy (5 a 15 minutos)"
if [ ! -d "$REPO/src-tauri" ]; then
  mkdir -p "$(dirname "$REPO")"
  git -c advice.detachedHead=false clone --depth 1 --branch "$HANDY_TAG" https://github.com/cjpais/Handy.git "$REPO"
fi
cd "$REPO"
if [ -z "$(git -C "$REPO" status --porcelain -- src-tauri/src)" ]; then
  git -C "$REPO" apply "$PATCH" || die "O patch não aplicou no Handy $HANDY_TAG."
  ok "Mudanças personalizadas aplicadas ao Handy $HANDY_TAG oficial"
else
  ok "Código do Handy já tem as mudanças personalizadas"
fi
bun install
bun run tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
BUILT="$REPO/src-tauri/target/release/bundle/macos/Handy.app"
[ -d "$BUILT" ] || die "A compilação não gerou o Handy.app."
quit_handy
if [ -d "$APP" ]; then
  backup="$HOME/.Trash/Handy-anterior-$(date +%Y%m%d-%H%M%S).app"
  mv "$APP" "$backup"
  warn "Handy anterior movido para a Lixeira ($(basename "$backup"))"
fi
cp -R "$BUILT" "$APP"
tccutil reset Accessibility "$BUNDLE_ID" >/dev/null 2>&1 || true
ok "Handy instalado em $APP"

# ---------------------------------------------------------------- 5. Whisper
step "5/7 Modelo de voz Whisper Turbo (1,6 GB)"
mkdir -p "$DATA/models"
if [ ! -f "$DATA/models/$WHISPER_FILE" ]; then
  curl -L --fail -o "$DATA/models/$WHISPER_FILE.part" "$WHISPER_URL"
  echo "$WHISPER_SHA  $DATA/models/$WHISPER_FILE.part" | shasum -a 256 -c --quiet \
    || { rm -f "$DATA/models/$WHISPER_FILE.part"; die "Hash do modelo não confere."; }
  mv "$DATA/models/$WHISPER_FILE.part" "$DATA/models/$WHISPER_FILE"
fi
ok "Whisper Turbo pronto"

# ---------------------------------------------------------------- 6. configurações
step "6/7 Aplicando as configurações (profile.json)"
if [ ! -f "$SETTINGS" ]; then
  open -g "$APP"   # primeira abertura cria o arquivo de configurações
  for _ in $(seq 1 30); do [ -f "$SETTINGS" ] && break; sleep 1; done
  [ -f "$SETTINGS" ] || die "O Handy não criou $SETTINGS."
fi
quit_handy
cp "$SETTINGS" "$SETTINGS.antes-vocal-assistent"
python3 - "$SETTINGS" "$HERE" <<'PY'
import json, sys, os
path, here = sys.argv[1], sys.argv[2]
prof = json.load(open(os.path.join(here, "profile.json")))
data = json.load(open(path))
s = data["settings"]
for name, binding in prof.pop("bindings").items():
    s["bindings"][name]["current_binding"] = binding
s.setdefault("post_process_models", {}).update(prof.pop("post_process_models"))
p = prof.pop("prompt")
text = open(os.path.join(here, p["file"])).read()
s["post_process_prompts"] = [x for x in s.get("post_process_prompts", []) if x["id"] != p["id"]]
s["post_process_prompts"].append({"id": p["id"], "name": p["name"], "prompt": text})
s.update(prof)
json.dump(data, open(path, "w"), indent=2, ensure_ascii=False)
PY
ok "Configurações aplicadas (cópia da anterior: settings_store.json.antes-vocal-assistent)"

# ---------------------------------------------------------------- 7. abrir com o Mac
step "7/7 Abrir junto com o Mac"
for item in /Applications/Ollama.app "$APP"; do
  name=$(basename "$item" .app)
  if ! osascript -e 'tell application "System Events" to get the name of every login item' 2>/dev/null | grep -q "$name"; then
    osascript -e "tell application \"System Events\" to make login item at end with properties {path:\"$item\", hidden:true}" >/dev/null 2>&1 \
      && ok "$name nos Itens de Início" || warn "Não consegui adicionar $name aos Itens de Início (faça em Ajustes > Geral > Itens de Início)"
  else
    ok "$name já está nos Itens de Início"
  fi
done
open "$APP"

cat <<'TXT'

====================================================================
 Pronto! Faltam 2 coisas que só você pode fazer:

 1. Ajustes do Sistema > Privacidade e Segurança > Acessibilidade
    -> ative o "Handy" (se não aparecer, clique em + e escolha
       /Applications/Handy.app)
 2. No primeiro ditado, clique em "Permitir" no pedido de Microfone.

 Como usar (qualquer app: Slack, WhatsApp, e-mail...):
   Option+Espaço  segure, fale e solte (ou toque, fale e toque de novo)
   "Traduza para o inglês ..."     -> cola em inglês
   "Traduza para o português ..."  -> cola em português
   sem pedir nada                   -> corrige no idioma em que você falou
   Esc            cancela a gravação
====================================================================
TXT
