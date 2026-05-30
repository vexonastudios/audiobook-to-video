# How to Use Audiobook to Video

This tool turns your audiobook audio files and book cover into an engaging, animated YouTube video. Follow these steps to get started:

## 1. Set Output Destination
Always start by choosing where to save your final `.mp4` video file. In the top left panel under **Output Destination**, click **Browse** and choose a folder and filename.

## 2. Add Your Book Assets
- **Cover Image:** Select the book's cover art. The app will automatically extract the dominant accent color from the image to tint your UI and text!
- **Background Image (Optional):** Leave it blank to use a dynamic, blurred version of your cover (highly recommended).
- **Brand Logo:** Add your publisher or series logo. The app builds a library of your logos and automatically tints the active one to match the cover's accent color.
- **Audio File:** Select the full WAV, MP3, or M4A audiobook file. The app will calculate the total duration.

## 3. Define Chapters (Right Panel)
You need chapter markers to tell the app when to transition. You can type them manually, import a text file, or import an SRT subtitle file.
Example Format:
```
(0:00) Introduction
(1:45) 1 - The Journey Begins
(45:20) 2 - The Sea of Darkness
```
*Click **Parse Chapters** to validate them. You will see a list appear below the text box.*

## 4. Adjust Styles & Preview (Center Panel)
- Use the sliders on the left to adjust background blur and opacity.
- Pick a **Transition Style** (like Fade, Cross Dissolve, or Zoom Blur) and set its duration. 
- Use the **Preview** section's dropdown above the canvas to see exactly what each chapter will look like.

## 5. Render Video
Once your fields are filled and chapters are parsed, click **Render Video**. The app uses hardware acceleration (like NVENC) to encode your video lightning fast. You can track progress in the log box at the bottom.
