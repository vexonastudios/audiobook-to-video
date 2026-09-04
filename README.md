# Audiobook to Video 🎧 ➡️ 🎬

**Audiobook to Video** is a powerful desktop application built by **Vexona Studios** designed to turn your audiobook audio files and book covers into engaging, animated YouTube videos. 

Built on Electron and powered by FFmpeg, it features hardware-accelerated rendering and a sleek, user-friendly interface to streamline your video generation workflow.

---

## ✨ Features

- **Quick Setup:** Load your Audiobook audio file (WAV/MP3), a cover image, and an optional background image or brand logo.
- **Auto-Chapters:** Paste your YouTube chapter timestamps directly into the app. It automatically parses them and creates visual chapter transitions in the final video.
- **Customizable Transitions:** Choose between smooth chapter transitions such as Fade to Black, Cross Dissolve, Lens Flare Burn, and Zoom Blur Push.
- **Video Intros:** Easily prepend an MP4 video intro with options to include audio, hard-cut, or smooth-fade into the audiobook.
- **Print Edition Promotion:** Optionally displays a polished lower-third 30 seconds into the audiobook using the selected cover, directing viewers to Kindle and paperback links in the description.
- **Dynamic Background Styling:** Fine-tune background Gaussian blur, opacity, vertical positioning, cover border thickness, and automatically extract accent colors from your cover art.
- **Efficient Static Rendering:** Chapter artwork and transitions are rendered once and reused while FFmpeg builds a broadly compatible constant-30fps video stream.
- **Hardware Acceleration:** Leverage NVIDIA NVENC for transitions, intros, and final video encoding.
- **Fast Audio:** Compatible MP3/M4A audio is copied directly; WAV and other sources are converted once and reused from a bounded audio cache.
- **Compatibility Mode:** The former segmented renderer remains available as an opt-in fallback.
- **Export Options:** Choose between H.264 for maximum compatibility or H.265 (HEVC) for ~40% smaller file sizes.

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
