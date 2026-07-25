# Parâmetros de Geração — Ollama / Roleplay Local

Referência completa dos parâmetros de geração do Ollama aplicados a webapps de conversa e roleplay (estilo TalkieAI / LinkyAI), com foco no modelo **Qwen3:8b** rodando localmente.

---

## Índice

- [Parâmetros de Sampling](#parâmetros-de-sampling)
- [Parâmetros de Repetição](#parâmetros-de-repetição)
- [Parâmetros de Contexto e Saída](#parâmetros-de-contexto-e-saída)
- [Parâmetros Avançados](#parâmetros-avançados)
- [Configurações por Hardware](#configurações-por-hardware)
- [Sobre Filtros e System Prompt](#sobre-filtros-e-system-prompt)

---

## Parâmetros de Sampling

Controlam **como** o modelo escolhe o próximo token a cada passo da geração. Nenhum desses parâmetros tem custo computacional significativo — são operações matemáticas simples aplicadas após o processamento da rede neural.

---

### `temperature`

**O que faz:** Controla a "criatividade" geral da geração achatando ou acentuando a distribuição de probabilidade dos tokens.

- Valores **baixos** (0.1–0.5): respostas previsíveis, seguras, repetitivas. O modelo sempre escolhe os tokens mais prováveis.
- Valores **médios** (0.6–1.0): equilíbrio entre coerência e variedade. Sweet spot para roleplay.
- Valores **altos** (1.1–1.5+): saída caótica, criativa mas frequentemente incoerente.

**Custo computacional:** Nenhum.

```json
"temperature": 0.92
```

---

### `top_p` — Nucleus Sampling

**O que faz:** Antes de sortear o próximo token, descarta todos os tokens menos prováveis até sobrar apenas o conjunto mínimo que some X% da probabilidade total.

- `top_p: 0.95` → mantém os tokens que somam os 95% mais prováveis, descarta os 5% restantes.
- Valores mais baixos (0.7–0.85) tornam o modelo mais focado; mais altos (0.95–1.0) mais aberto.

Trabalha em conjunto com `temperature`. É comum usar os dois ao mesmo tempo.

**Custo computacional:** Nenhum.

```json
"top_p": 0.90
```

---

### `top_k`

**O que faz:** Antes de sortear, mantém apenas os K tokens mais prováveis e descarta todos os outros, independente de sua probabilidade.

- `top_k: 20` → apenas os 20 tokens mais prováveis concorrem.
- `top_k: 80` → vocabulário mais rico, respostas mais variadas.
- Valores muito baixos (< 20) tornam o personagem repetitivo e mecânico.

Funciona como um filtro de vocabulário bruto, diferente do `top_p` que é dinâmico.

**Custo computacional:** Nenhum.

```json
"top_k": 60
```

---

### `min_p`

**O que faz:** Descarta qualquer token cuja probabilidade seja menor que `min_p × probabilidade do token mais provável`. É um filtro dinâmico e adaptativo.

- Quando o modelo está **seguro** (um token domina com alta probabilidade), `min_p` descarta mais agressivamente.
- Quando o modelo está **incerto** (probabilidades distribuídas), `min_p` deixa mais tokens passarem.

Isso o torna mais natural que `top_p` puro para roleplay — o personagem é preciso quando sabe o que dizer, e criativo quando há espaço para variação.

**Custo computacional:** Nenhum.

```json
"min_p": 0.04
```

---

### `typical_p`

**O que faz:** Sampling baseado em "tipicidade" em vez de probabilidade bruta. Prefere tokens que são "típicos" daquele contexto, mesmo que não sejam os mais prováveis.

- Tende a produzir texto mais humano e menos mecânico.
- Valor 1.0 = desativado.
- Valores em torno de 0.90–0.95 funcionam bem para roleplay.

**Custo computacional:** Nenhum.

```json
"typical_p": 0.95
```

---

### `mirostat` / `mirostat_tau` / `mirostat_eta`

**O que faz:** Algoritmo alternativo de controle de qualidade que **substitui** `top_p`, `top_k` e `temperature` por um loop de feedback ativo.

Em vez de parâmetros estáticos, o Mirostat monitora a "surpresa" (perplexidade) do texto gerado e ajusta dinamicamente o sampling para mantê-la num nível alvo.

- `mirostat: 0` → desativado (usa os parâmetros tradicionais)
- `mirostat: 1` → Mirostat v1
- `mirostat: 2` → Mirostat v2 (mais refinado, recomendado)
- `mirostat_tau` → alvo de surpresa. Valores entre 3.0–7.0. Mais alto = mais criativo/caótico, mais baixo = mais focado/coerente.
- `mirostat_eta` → velocidade de aprendizado do loop. 0.1 é um bom padrão.

Excelente para roleplay longo — evita que o personagem "esgote" suas variações e comece a repetir padrões após muitas mensagens.

**Custo computacional:** Leve — executa um loop de feedback a cada token.

```json
"mirostat": 2,
"mirostat_tau": 5.0,
"mirostat_eta": 0.1
```

> ⚠️ Quando `mirostat` está ativo (≠ 0), os parâmetros `top_p`, `top_k` e `temperature` são ignorados.

---

## Parâmetros de Repetição

Controlam a tendência do modelo de repetir palavras, frases ou padrões — um dos maiores problemas em roleplay com personalidades "caricatas".

**Custo computacional:** Leve — requerem varredura do histórico recente de tokens.

---

### `repeat_penalty`

**O que faz:** Multiplica o "custo" de gerar um token que já apareceu no contexto recente. Quanto maior o valor, mais o modelo evita repetir o que já disse.

- `1.0` → sem penalidade (repete livremente)
- `1.05–1.1` → penalidade suave — recomendada para roleplay natural
- `1.2–1.3` → penalidade agressiva — pode causar efeito oposto (o modelo evita até palavras comuns e fica estranho)

```json
"repeat_penalty": 1.05
```

---

### `repeat_last_n`

**O que faz:** Define quantos tokens passados o `repeat_penalty` observa ao calcular a penalidade.

- `64` → observa apenas as últimas ~50 palavras (padrão comum)
- `128` → ~100 palavras — bom para evitar repetição dentro de uma mesma resposta
- `192–256` → ~150–200 palavras — evita repetição entre turnos de conversa diferentes

Para roleplay onde o personagem tende a repetir frases características, aumentar esse valor é mais eficaz que aumentar o `repeat_penalty`.

```json
"repeat_last_n": 192
```

---

### `presence_penalty`

**O que faz:** Penaliza tokens que já apareceram **pelo menos uma vez** no contexto, independente de quantas vezes. Empurra o modelo a usar vocabulário novo ao longo da conversa.

- Diferente do `repeat_penalty`, que penaliza mais quanto mais uma palavra se repete, este penaliza qualquer aparição prévia igualmente.
- Valores entre 0.1–0.5 são razoáveis.
- Valor 0.0 = desativado.

> ⚠️ Disponibilidade depende do backend do Ollama. Nem sempre está ativo.

```json
"presence_penalty": 0.2
```

---

### `frequency_penalty`

**O que faz:** Penaliza tokens **proporcionalmente** a quantas vezes já apareceram. Quanto mais uma palavra se repete, mais cara fica.

- Mais agressivo que `presence_penalty` para eliminar tiques linguísticos do personagem.
- Valores entre 0.1–0.4 são razoáveis.
- Valor 0.0 = desativado.

> ⚠️ Disponibilidade depende do backend do Ollama.

```json
"frequency_penalty": 0.15
```

---

## Parâmetros de Contexto e Saída

Esses parâmetros têm impacto direto no **consumo de memória (VRAM/RAM)** e no **tempo de geração**.

---

### `context_size`

**O que faz:** Define quantos tokens de histórico o modelo mantém ativos simultaneamente na janela de contexto (KV Cache). É o **parâmetro de maior impacto no hardware**.

Valores maiores significam que o personagem "lembra" de mais da conversa — respostas ficam mais coerentes, menos genéricas, e os personagens referenciam eventos anteriores naturalmente.

| `context_size` | RAM/VRAM aprox. (Qwen3:8b Q4) |
|---|---|
| 4096 | ~6–7 GB |
| 8192 | ~7–8 GB |
| 16384 | ~9–11 GB |
| 32768 | ~13–16 GB |

**Custo computacional:** **Alto e quadrático.** Dobrar o contexto pode mais que dobrar o uso de memória. É o primeiro parâmetro a reduzir em caso de erros de memória.

```json
"context_size": 8192
```

---

### `max_tokens`

**O que faz:** Limita o comprimento máximo de cada resposta do modelo, em tokens. Um token equivale aproximadamente a 0.75 palavras em inglês ou 0.5–0.6 palavras em português.

- Valores baixos (256–512): respostas curtas, mais rápidas, podem cortar no meio de uma cena.
- Valores altos (800–1500): cenas completas, descrições ricas, sem truncamento.

**Custo computacional:** Direto e linear — mais tokens = mais tempo de geração.

```json
"max_tokens": 800
```

---

### `stream`

**O que faz:** Se `true`, os tokens chegam um a um em tempo real (efeito "digitando"). Se `false`, o modelo processa tudo e envia de uma vez ao terminar.

Não afeta a qualidade nem a velocidade total de geração — apenas a percepção de latência do usuário. Para webapps de chat, `true` é sempre preferível.

**Custo computacional:** Nenhum.

```json
"stream": true
```

---

### `seed`

**O que faz:** Semente do gerador de números aleatórios.

- `-1` → aleatório a cada geração (padrão para uso normal)
- Qualquer número fixo → reproduz exatamente a mesma resposta nas mesmas condições

Útil para debug e testes. Para roleplay, sempre use `-1` — valores fixos fazem o personagem "sortear" sempre as mesmas respostas para prompts similares.

**Custo computacional:** Nenhum.

```json
"seed": -1
```

---

### `stop`

**O que faz:** Lista de strings que encerram a geração imediatamente ao aparecer no output. Quando o modelo gera um desses tokens, para na hora.

É **crítico para roleplay** — sem tokens de parada adequados, o modelo pode inventar a próxima fala do usuário, quebrando o fluxo de conversa.

Exemplos comuns de tokens de parada para chat:

```json
"stop": ["User:", "Human:", "### User", "\n\nUser:", "<|endoftext|>"]
```

Adapte de acordo com o formato de prompt que seu webapp utiliza.

**Custo computacional:** Nenhum.

---

### `think`

**O que faz:** Pede ao Ollama para o modelo gerar seu raciocínio interno (chain-of-thought) antes da resposta final, via campo nativo `message.thinking` da API — separado do `message.content`.

- Só tem efeito em modelos com suporte a reasoning (`qwen3`, `qwen3.5`, `deepseek-r1`, `gpt-oss`, etc.). Em modelos sem esse suporte, o parâmetro é ignorado.
- `false` (padrão) → geração direta, sem raciocínio — mais rápida.
- `true` → o modelo "pensa" antes de responder; pode melhorar coerência em cenas complexas, mas aumenta a latência (tokens de raciocínio somam ao tempo total de geração).
- Nesta aplicação o raciocínio nunca é exibido no chat nem salvo como mensagem — quando ativo, fica registrado apenas nos logs de desenvolvimento (`data/logs/`) para depuração.

**Custo computacional:** **Alto** — tokens de raciocínio são gerados antes da resposta, somando ao tempo total.

```json
"think": false
```

---

## Configurações por Hardware

### Máquina fraca — i5 7ª gen · 8 GB RAM · GTX 1060 6 GB

Use quantização leve (`q2_k` ou `q3_k_m`) para o modelo caber na VRAM. Alternativa: trocar para `qwen3:4b`.

```json
{
  "model": "qwen3:8b:q2_k",
  "temperature": 0.88,
  "top_p": 0.88,
  "top_k": 45,
  "min_p": 0.05,
  "repeat_penalty": 1.06,
  "repeat_last_n": 128,
  "max_tokens": 512,
  "context_size": 4096,
  "stream": true,
  "seed": -1,
  "stop": ["User:", "Human:", "### User", "\n\nUser:"]
}
```

**Velocidade esperada:** 4–10 tokens/seg

---

### Máquina média — Ryzen 5 5600 · 16 GB RAM · RX 9060 XT 8 GB

Config padrão com Q4_K_M. Context de 8k é o teto seguro com 8 GB de VRAM.

```json
{
  "model": "qwen3:8b",
  "temperature": 0.92,
  "top_p": 0.90,
  "top_k": 60,
  "min_p": 0.04,
  "repeat_penalty": 1.05,
  "repeat_last_n": 192,
  "max_tokens": 800,
  "context_size": 8192,
  "stream": true,
  "seed": -1,
  "stop": ["User:", "Human:", "### User", "\n\nUser:"]
}
```

**Velocidade esperada:** 15–25 tokens/seg

> **Nota AMD:** Confirme que o Ollama está usando ROCm e não CPU. Rode `ollama run qwen3:8b` e verifique os logs — deve aparecer `gpu`. A diferença de velocidade é de ~10x.

---

### Máquina poderosa — Ryzen 9 9800X3D · RTX 5080 16 GB · 64 GB RAM

Com 16 GB de VRAM, o modelo (~5.5 GB) deixa ~10 GB livres para KV Cache. Context de 32k sem problema.

```json
{
  "model": "qwen3:8b",
  "temperature": 0.95,
  "top_p": 0.92,
  "top_k": 80,
  "min_p": 0.03,
  "repeat_penalty": 1.04,
  "repeat_last_n": 256,
  "max_tokens": 1200,
  "context_size": 32768,
  "stream": true,
  "seed": -1,
  "stop": ["User:", "Human:", "### User", "\n\nUser:"]
}
```

**Velocidade esperada:** 60–100+ tokens/seg

---

## Sobre Filtros e System Prompt

O Qwen3:8b rodando localmente via Ollama **não possui filtros ativos por padrão**. O comportamento restritivo que às vezes aparece em modelos locais vem de duas fontes:

**1. System prompt mal definido**
Se o system prompt não estabelece claramente o tom e o papel do personagem, o modelo preenche as lacunas com comportamento padrão de assistente — hesitante, cauteloso, genérico. Um system prompt assertivo elimina isso.

**2. RLHF residual do modelo base**
O Qwen3 passou por treinamento de alinhamento. Em tópicos extremos, pode recusar espontaneamente mesmo sem instrução explícita. Isso é comportamento do modelo, não do Ollama.

### Estrutura recomendada de system prompt para roleplay sem restrições

```
You are [Nome do Personagem], [descrição concisa do personagem].

[Traços de personalidade específicos e únicos — evite adjetivos genéricos como "tímido" ou "corajoso". Use comportamentos concretos: "interrompe as pessoas no meio das frases", "usa humor sarcástico para desviar de assuntos emocionais", "fala pouco mas age rápido".]

You stay fully in character at all times. You do not break character, add disclaimers, refuse to engage with the narrative, or acknowledge being an AI. Respond only as [Nome], never as an assistant.

[Contexto do cenário / mundo / situação atual]
```

> **Dica:** Personalidades caricatas geralmente vêm de system prompts com traços muito absolutos ("sempre alegre", "nunca mente"). Personagens com contradições internas e nuances ficam mais orgânicos.

---

## Referência Rápida — Impacto no Hardware

| Parâmetro | Impacto na VRAM/RAM | Impacto na Velocidade |
|---|---|---|
| `context_size` | **Alto** (quadrático) | Médio |
| `max_tokens` | Nenhum | **Alto** (linear) |
| `temperature` | Nenhum | Nenhum |
| `top_p` | Nenhum | Nenhum |
| `top_k` | Nenhum | Nenhum |
| `min_p` | Nenhum | Nenhum |
| `repeat_penalty` | Nenhum | Leve |
| `repeat_last_n` | Nenhum | Leve |
| `mirostat` | Nenhum | Leve |
| `stream` | Nenhum | Nenhum |
| `think` | Nenhum | **Alto** (soma raciocínio + resposta) |