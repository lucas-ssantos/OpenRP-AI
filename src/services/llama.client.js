import { appConfig } from "../config.js";

/*
export function assertLoadedModel(model) {
    if (model !== appConfig.llama.model) {
        throw new Error(
            `O modelo "${model}" não está carregado. O llama-server está executando ` +
            `"${appConfig.llama.model}"; altere o modelo global e reinicie o OpenRP AI.`
        );
    }
}
*/

const ROUTER_MODEL_IDS = new Set([
    "gemma4-12b",
    "stheno-intimate",
]);

export function assertLoadedModel(model) {
    if (appConfig.llama.routerMode === true) {
        if (ROUTER_MODEL_IDS.has(model)) {
            return;
        }

        throw new Error(
            `Modelo "${model}" não registrado na configuração do router.`
        );
    }

    if (model !== appConfig.llama.model) {
        throw new Error(
            `O modelo "${model}" não está carregado. ` +
            `O llama-server está executando "${appConfig.llama.model}".`
        );
    }
}

export function llamaChatBody({
    model,
    messages,
    stream = false,
    think = false,
    options = {},
    format = null,
}) {
    assertLoadedModel(model);
    const body = {
        model,
        messages,
        stream,
        max_tokens: options.num_predict,
        temperature: options.temperature,
        top_p: options.top_p,
        top_k: options.top_k,
        min_p: options.min_p,
        repeat_penalty: options.repeat_penalty,
        repeat_last_n: options.repeat_last_n,
        seed: options.seed,
        stop: options.stop,
        cache_prompt: true,
        chat_template_kwargs: { enable_thinking: think },
    };
    if (format) {
        body.response_format = {
            type: "json_schema",
            json_schema: { name: "structured_response", strict: false, schema: format },
        };
    }
    return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

export function llamaChatEndpoint() {
    return appConfig.llama.chatEndpoint;
}

export function extractMessageContent(data) {
    return data.choices?.[0]?.message?.content || "";
}
