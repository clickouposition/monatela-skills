# VOCAL-ASSISTENT

Versão personalizada do [Handy](https://github.com/cjpais/Handy) (ditado por voz open source, licença MIT) para quem fala **português e inglês** no trabalho.

Um atalho só, **Option+Espaço**, em qualquer app (Slack, WhatsApp, e-mail, Claude...):

| Você fala | O que é colado |
|---|---|
| Em português | Português corrigido, natural, sem ponto final |
| Em inglês | Inglês americano corrigido e casual |
| "**Traduza para o inglês** ..." | Tradução contextual para o inglês |
| "**Traduza para o português** ..." | Tradução contextual para o português |
| "**Traduz** ..." | Inverte o idioma |
| ... e diz "formal" | Tom formal |

Tudo roda **no próprio Mac, grátis e offline**: Whisper Large v3 Turbo transcreve, e o Gemma 4 (via Ollama) corrige e traduz.

## Requisitos

- Mac com **Apple Silicon** (M1 ou mais novo), macOS recente
- **16 GB de RAM** recomendado (os dois modelos ficam carregados, uns 11 GB)
- **~20 GB livres** (ferramentas, modelos e compilação)
- Internet durante a instalação

## Instalação (um comando)

```bash
git clone https://github.com/clickouposition/monatela-skills.git
cd monatela-skills/skills/vocal-assistent
bash install-macos.sh
```

O instalador baixa o Handy oficial **v0.10.2**, aplica as mudanças de `patches/handy-v0.10.2-custom.patch`, compila e instala. O código fica em `~/.vocal-assistent/Handy-v0.10.2`.

Leva de 15 a 30 minutos, quase tudo é download e compilação. Pode rodar de novo sem problema: ele pula o que já está instalado.

Com uma IA (Claude Code etc.), basta pedir: *"instale a skill vocal-assistent deste repositório"*. Ela segue o [`SKILL.md`](SKILL.md).

Depois, só você pode fazer estas duas coisas:
1. **Ajustes do Sistema → Privacidade e Segurança → Acessibilidade** → ative o **Handy**
2. No primeiro ditado, clique em **Permitir** no pedido de **Microfone**

## Para assistentes de IA (Claude Code, Codex, Cursor...)

Se você é uma IA instalando isto para alguém:

1. Siga o [`SKILL.md`](SKILL.md). Em resumo: rode `bash install-macos.sh` nesta pasta. Ele não pede senha e para com uma mensagem clara se algo faltar.
2. Se ele parar pedindo as **Command Line Tools**, a pessoa precisa clicar em *Instalar* na janela do macOS. Depois rode o script de novo.
3. Você **não consegue** liberar Acessibilidade nem Microfone. Peça para a pessoa fazer (instruções no fim do script). Para confirmar que deu certo, procure `Shortcuts initialized successfully` em `~/Library/Logs/com.pais.handy/handy.log`.
4. Se o log mostrar `SecureInput`, um campo de senha ou o "Entrada de Teclado Segura" do Terminal está bloqueando atalhos. Peça para fechar.
5. Não troque o provedor de IA nem coloque chaves de API sem a pessoa pedir.

## O que foi mudado no Handy

Tudo marcado com `// [custom]` no código:

| Arquivo | Mudança |
|---|---|
| `src-tauri/src/custom_lang.rs` | **Novo.** Detecta pedidos de tradução e o idioma falado, e manda uma ordem clara para a IA (modelos pequenos erram o idioma sozinhos). Tem testes. |
| `src-tauri/src/actions.rs` | Liga a detecção de idioma ao pós-processamento (placeholder `${language_directive}` no prompt) |
| `src-tauri/src/llm_client.rs` | Pede ao Ollama para manter o modelo sempre carregado (`keep_alive`), sem atraso de "modelo frio" |
| `src-tauri/src/settings.rs` | Padrões: atalhos, Ollama + `gemma4:e4b`, prompt "Auto PT/EN", colagem confiável, Whisper sempre carregado, sem atualização automática |

Arquivos desta pasta:
- `SKILL.md`: passo a passo para assistentes de IA
- `install-macos.sh`: o instalador
- `patches/handy-v0.10.2-custom.patch`: as mudanças no código do Handy (as da tabela acima)
- `profile.json`: configurações aplicadas pelo instalador (também valem para quem já tinha o Handy)
- `prompts/auto-pt-en.txt`: o prompt de correção/tradução

## Personalizar

- **Prompt:** edite `prompts/auto-pt-en.txt` e rode o instalador de novo (ou cole o texto em Handy → Pós-processamento).
- **Atalhos e opções:** edite `profile.json`.
- **Usar o Claude em vez do Gemma** (melhor qualidade, pago por uso): em Handy → Pós-processamento, escolha *Anthropic* e cole sua chave de API.

## Atualizações

Esta versão **não se atualiza sozinha** (o atualizador trocaria pela versão oficial e apagaria as mudanças). Para mudar para uma versão nova do Handy, alguém precisa gerar o patch de novo para essa versão (o `git apply` avisa se ele não encaixar) e atualizar `HANDY_TAG` no `install-macos.sh`.

Cada nova compilação pede para liberar a **Acessibilidade** de novo. É normal para apps compilados em casa.

## Problemas comuns

| Sintoma | Solução |
|---|---|
| Colou um texto antigo da área de transferência | Já mitigado com "Colagem confiável". Se repetir, aumente `paste_delay_after_ms` em `profile.json` |
| Texto colado sem correção/tradução | O Ollama não está rodando. Abra o Ollama.app |
| Atalho não faz nada | Acessibilidade desligada, ou um campo de senha aberto |
| Muito lento | Feche apps pesados; com menos de 16 GB de RAM, os modelos competem por memória |

## Licença

O Handy é MIT ([licença original](https://github.com/cjpais/Handy/blob/main/LICENSE)), © CJ Pais. Este patch e os scripts seguem a mesma licença.
