# Audiobook to Video 🎧 ➡️ 🎬

**Audiobook to Video** is a powerful desktop application built by **Vexona Studios** designed to turn your audiobook audio files and book covers into engaging, animated YouTube videos. 

Built on Electron and powered by FFmpeg, it features hardware-accelerated rendering and a sleek, user-friendly interface to streamline your video generation workflow.

---

## ✨ Features

- **Quick Setup:** Load your Audiobook audio file (WAV/MP3), a cover image, and an optional background image or brand logo.
- **Auto-Chapters:** Paste your YouTube chapter timestamps directly into the app. It automatically parses them and creates visual chapter transitions in the final video.
- **Customizable Transitions:** Cut is the default. Optional Fade to Black, Cross Dissolve, Lens Flare Burn, and Zoom Blur Push straddle the chapter markers and automatically shorten around short chapters, without shifting later chapters or audio.
- **Video Intros:** Easily prepend an MP4 video intro with options to include audio, hard-cut, or smooth-fade into the audiobook.
- **Opening Title Sequence:** Keep the cover fixed while a custom heading, title, subtitle, optional series/book number, author, original publication, and website cards rotate through the chapter-title area before dissolving into the first chapter. Add an optional author photo to show a circular portrait above the author’s name, then adjust its horizontal focus, vertical focus, and zoom with a live preview; without one, the original text-only card is preserved. Each card is rendered once and FFmpeg generates the crossfades without hundreds of temporary PNG frames.
- **Print Edition Promotion:** Optionally displays a lower-third at 0:30, then around every two hours with up to ten minutes of random variation. Eight-second repeats finish before the closing minute. Use the book cover or a separate transparent PNG such as a 3D book mockup to direct viewers to Kindle and paperback links in the description.
- **Dynamic Background Styling:** Fine-tune background Gaussian blur, opacity, vertical positioning, cover border thickness, and automatically extract accent colors from your cover art.
- **Efficient Static Rendering:** Chapter artwork and transitions are rendered once and reused while FFmpeg builds a broadly compatible constant-30fps video stream.
- **Hardware Acceleration:** Leverage NVIDIA NVENC for transitions, intros, and final video encoding.
- **Fast Audio:** Compatible MP3/M4A audio is copied directly; WAV and other sources are converted once and reused from a bounded audio cache.
- **Compatibility Mode:** The former segmented renderer remains available as an opt-in fallback.
- **Export Options:** Choose between H.264 for maximum compatibility or H.265 (HEVC) for ~40% smaller file sizes.
- **Open Completed Video:** Launch a successful export immediately in the system's default video player.
- **Render Timing:** Save the last 50 successful render timings locally, estimate a comparable video's render time from its length, and update remaining time using measured progress checkpoints. The last render time remains visible after restarting.
- **Completion Alerts:** Hear a three-note chime and see a desktop notification when an export succeeds. The sound preference is saved across projects; use **Test sound** to check it. Failed or cancelled renders do not play the success chime.

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v20+ recommended)
- npm

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/vexonastudios/audiobook-to-video.git
   cd audiobook-to-video
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run the app locally:**
   ```bash
   npm start
   ```

### Building for Release
The project uses `electron-builder` and is configured via GitHub Actions to automatically build and release binaries for Windows (`.exe`) and macOS (`.dmg`) when a new version tag (e.g. `v1.1.21`) is pushed.

To build locally:
```bash
# Build for your current operating system
npm run dist
```

The application icon is maintained as `assets/icon-source.png`. After changing it,
regenerate the 1024px PNG and multi-resolution Windows ICO with:

```bash
npm run icons
```

---

## 🛠️ Tech Stack
- **Electron:** Desktop application framework
- **FFmpeg (fluent-ffmpeg / ffmpeg-static):** Media processing and encoding engine
- **Sharp:** High-performance image processing

---

## 📄 License
© Vexona Studios. All rights reserved.
