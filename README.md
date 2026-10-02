# ✋ AirCanvas — AI Hand Drawing

Draw in the air using just your webcam and hand gestures. Powered by [MediaPipe Hands](https://google.github.io/mediapipe/solutions/hands).

## 🎮 Gestures

| Gesture | Action |
|---|---|
| ☝️ Index finger up (others curled) | **Draw** |
| ✌️ Index + Middle up (others curled) | **Erase** |
| ✊ Fist or open hand | **Hover** (no drawing) |

## ✨ Features

- Real-time hand tracking via MediaPipe Hands ML model
- One Euro Filter for smooth, lag-free strokes
- Full RGB spectrum color picker + quick swatches
- Adjustable brush size
- Eraser tool
- Pause / Resume tracking toggle
- Clear canvas button
- Fullscreen camera feed with mirrored display

## 🚀 Run Locally

No build step needed — it's pure HTML/CSS/JS.

```bash
cd hand-drawing-app
python -m http.server 8000
```

Then open **http://localhost:8000** in Chrome or Edge and allow camera access.

## 🌐 Live Demo

Deployed on GitHub Pages: [View Live](https://YOUR_USERNAME.github.io/aircanvas)

## 🛠️ Tech Stack

- [MediaPipe Hands](https://google.github.io/mediapipe/solutions/hands) — hand landmark detection
- HTML5 Canvas API — drawing engine
- One Euro Filter — cursor smoothing algorithm
- Vanilla JS / CSS — no frameworks

## 📁 Project Structure

```
hand-drawing-app/
├── index.html   # App shell & UI
├── style.css    # Glassmorphism UI styles
└── script.js    # Hand tracking & drawing logic
```

## 📸 Screenshot

> Point your index finger at the camera to start drawing!

---

Made with ❤️ using MediaPipe + Canvas API
