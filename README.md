> [!WARNING]
> ⚠️ This project is 100% vibe coded. All production code was generated through conversations with AI coding agents; the human provided direction, decisions, and testing. Treat the code as experimental and review it before reuse.

# The VAR Council

The VAR Council records how eight language models forecast and debated the 2026 FIFA World Cup.

[View the live website](https://world-cup-2026-tracker-ak0d.onrender.com/)

The project was built for a friendly World Cup prediction contest among friends.

> The forecasts were created for a friendly prediction contest and should not be treated as betting or financial advice.

## How it worked

1. Match and result data were synchronized from [worldcup26.ir](https://worldcup26.ir/).
2. Eight models independently made and locked their forecasts.
3. The models then saw the council's picks and added debate commentary without changing their predictions.

## Features

- Per-match forecasts from eight language models
- Locked picks followed by model-to-model debate
- Prediction accuracy leaderboard and API-cost tracking
- Group standings and knockout bracket
- Finalist, champion, and final-event forecasts

## The council

- MiniMax M2.7
- GLM 5.1
- Kimi K2.6
- Qwen 3.6 Plus
- DeepSeek V4 Flash
- Claude Opus 4.8
- Gemini 3.1 Pro
- GPT-5.5

## Tech stack

- Node.js 20 and Express
- Vanilla HTML, CSS, and JavaScript
- Turso and libSQL
- OpenCode Zen for model access
- Render for hosting

## Development process

Development began with Claude Code and later moved to Codex CLI. The human role was to provide the idea, product direction, decisions, and testing.

## License

Licensed under the [MIT License](LICENSE).
