# Open GenOffice modifications

Open GenOffice is derived from
[`genspark-ai/genoffice`](https://github.com/genspark-ai/genoffice), beginning
with upstream commit `4da673d4dfa994bd0b4a9bc43430e4a058a17c61`.

The fork's material changes include:

- first-class OpenRouter, Anthropic, and OpenAI routes alongside Genspark;
- encrypted device-local storage for user-supplied provider keys;
- a global default model and sticky per-document provider/model selection;
- model catalog discovery, compatibility filtering, and key verification;
- cross-model conversation continuation without implicit fallback;
- provider-aware error handling and bounded retry suggestions;
- independent application identity and update isolation;
- Open GenOffice repository, packaging, documentation, and visual identity.

The initial public snapshot is compared to the upstream commit above for the
file-level record of additions and changes. The upstream copyright and
attribution remain in `LICENSE` and `NOTICE`.
