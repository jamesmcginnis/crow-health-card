# ❤️ Crow Health Card

A health summary card for [Home Assistant](https://www.home-assistant.io/) in the style of Apple Health. It reads your Apple Health data from the Home Assistant Companion App on iPhone and shows it as a set of modules: vitals, sleep, heart, activity, body and more. Each module has detailed charts, and you can export any of them as CSV, JSON or PDF. There's also an optional AI insights hub. Everything can be set up without writing any YAML.

---

> ✨ **AI features are optional.** Nothing AI-powered runs until you turn on AI features and choose a conversation agent in the editor (see [AI Features Setup](#-ai-features-setup-optional) below). Without an agent, the card works fully as a health dashboard, and none of the core features depend on it.

> ⚠️ **Only tested with Apple Health via the Home Assistant Companion App on iPhone.**

> ⚠️ **Not medical advice.** Every number, score and band on this card is a calculated estimate or a summary of your own sensor data, and the AI features are told never to give medical advice. None of it replaces your doctor, your devices or your own judgement.

---

## ✨ Features

### Modules
Turn each module on or off and drag them into the order you want. Entities are **found automatically** from your Companion App sensors, and you can override any of them with your own entity.

| Category | Modules |
|---|---|
| **Highlights** | Vitals (heart rate, blood oxygen, respiratory rate, body temperature and HRV, all in one place) · Sleep Score (0–100, worked out from your sleep stages) |
| **Heart** | Heart Rate · Resting Heart Rate · Heart Rate Variability · Walking Heart Rate Average · Blood Pressure (systolic and diastolic) |
| **Respiratory** | Blood Oxygen · Respiratory Rate · VO2 Max |
| **Body** | Body Temperature · Basal Body Temperature · Weight · Body Fat Percentage · Lean Body Mass · Blood Glucose · Water |
| **Activity** | Steps · Walking + Running Distance · Flights Climbed · Active Energy · Resting Energy · Average Active Pace |
| **Sleep** | Time Asleep, with REM, Deep, Core and Awake stages |

- **Colour bands.** Readings are shown green, amber or red against typical ranges, and readings that aren't physically plausible are filtered out.
- **Blood glucose in mg/dL or mmol/L.** The target bands change to match (70–180 mg/dL or 3.9–10.0 mmol/L). The glucose detail view also shows time in range, the trend, an estimate for 30 minutes from now, and an estimated A1C.

### Detail views
- Tap any module for a **detail chart** you can switch between **Day, Week, Month and 6 Months**.
- Tap any stat or chart point for an explanation, with a one-line AI comment when AI is on.
- **Export any module** as **CSV, JSON or PDF**, for the range you choose. PDF reports include your card title and accent colour.

### Appearance
- **Style**: **Classic**, or **Glass**, which is frosted and see-through with blur and soft highlights.
- **Theme** for the Glass style and its pop-ups: Auto (follows Home Assistant), Light or Dark.
- **Glass** slider, from clear to frosted.
- **Accent colour**, which is used for the AI insight card, the ring charts and the PDF report headers. Pick one of the presets or any colour you like.
- **Card title**, e.g. "Summary".

### Storage
The card remembers your preferences in the browser. Turn on **Persistent Storage** to sync them through Home Assistant's own user data instead, so they follow you across devices.

### AI features (optional)
These need a Home Assistant conversation agent. Each feature has its own toggle:
- **Daily Summary**: a one-line AI summary at the top of the card. Tap it to open **AI Insights**.
- **Trend Notes**: points out notable changes from one week to the next in the summary.
- **Weekly/Monthly Recap**: a longer digest in AI Insights that covers several metrics together.
- **Ask About Your Health**: a question box on the summary screen, answered using your recent data.
- **AI Advice**: an on-demand **"Improve This"** tip on modules where general lifestyle advice makes sense (Activity, Sleep, Water and Weight). It never appears for vitals or anything medical.

The assistant only sees the health data shown on the card. Nothing is sent until an AI feature is used, and answers are cached.

---

## 📱 Getting Health Data into Home Assistant

The card has only been tested with **Apple Health** data, shared through the **Home Assistant Companion App** on iPhone:

1. Install the Companion App and sign in to your Home Assistant.
2. In the app, allow access to Apple Health when it asks, or turn it on in the app's settings.
3. Make sure the health sensors you want are turned on. They'll show up in Home Assistant as `sensor.<your_phone>_heart_rate`, `sensor.<your_phone>_steps` and so on.

The card finds these sensors automatically. Modules without a matching sensor simply stay empty, and you can hide them in the editor.

---

## Configuration

Add the card from the card picker. The editor finds your health sensors for you, and everything else is set in the built-in visual editor, so you don't need any YAML. See the README for the full list of YAML options and module keys.

---

## 🤖 AI Features Setup (Optional)

AI features stay off until you turn them on and choose a conversation agent. **Google Gemini** is the recommended and best-tested agent:

### Step 1 — Enable the Generative Language API

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in
2. Create a new project (or select an existing one)
3. Go to **APIs & Services → Library**
4. Search for **Generative Language API** and click **Enable**

> ⚠️ This step is essential. An API key without the Generative Language API enabled will return errors immediately.

### Step 2 — Create an API Key

1. In Google Cloud Console go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → API key** and copy the key

### Step 3 — Add Google Generative AI to Home Assistant

1. In Home Assistant go to **Settings → Devices & Services → + Add Integration**
2. Search for **Google Generative AI** and select it
3. Paste your API key and click Submit
4. The recommended model settings work fine. If you choose a model yourself, pick a **current Flash model**. Google retires older models regularly; `gemini-2.0-flash` was shut down in June 2026.

### Step 4 — Configure the Card

In the card's visual editor, open **AI Features**, turn on **Enable AI Features**, and choose your Google AI agent under **Conversation Agent**.

### Rate limits

Free-tier limits vary by model and change over time, so check Google AI Studio for your current quota. The card only calls the agent when you use an AI feature and it caches answers, so you're unlikely to reach the limit in normal use. If you do see a quota message, it resets the next day.
