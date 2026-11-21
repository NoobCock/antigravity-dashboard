# antigravity-dashboard

A status bar and token usage dashboard plugin for Antigravity.

[中文](README.zh-CN.md)

## Features

- **Inline status bar**: Shows generation speed, cache hit rate, and context window usage next to the input box.
- **Quota & reset timers**: Displays 5-hour and weekly quota remaining, reset countdowns, and estimated remaining tokens.
- **Token usage & API cost**: Automatically summarizes local conversation history across Today, This week, Since last reset, This month, and All time, alongside equivalent API cost.
- **Custom date ranges & model breakdown**: Supports Day, Week, Month, and Custom date ranges, merges model variants automatically, and folds usage by thinking level (click any model to expand).
- **Remaining token estimator**: Estimates remaining tokens by recent model mix or a single model, with live Google API pricing sync, custom per-model prices, and adjustable cache hit rate.
- **Bilingual UI**: Switch between English and Chinese.

## Screenshots

### Inline bar & quota popover

![Inline status bar and quota popover](docs/assets/preview-inline.png)

### Activity overview

![Token usage activity overview](docs/assets/preview-activity.png)

### Usage details (custom range & thinking levels)

![Usage details with custom range and expandable thinking levels](docs/assets/preview-details.png)

### Remaining token estimate

![Remaining token estimate and pricing](docs/assets/preview-estimate.png)

## Install

Requires Python 3 and Antigravity (2.34+).

```bash
git clone https://github.com/NoobCock/antigravity-dashboard.git
cd antigravity-dashboard
python manage.py install --panel-only
```

Restart Antigravity after installing.

### Disable or uninstall

```bash
python manage.py disable
python manage.py uninstall
```

## License

[MIT](LICENSE)
