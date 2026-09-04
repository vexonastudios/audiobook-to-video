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
- Enable **Opening Title Sequence** to rotate the book title/subtitle, author, original publication, and site through the right-side title area at the start. Each completed card lasts about three seconds; the cover remains fixed and chapter/audio timing does not change.
- Use the **Preview** section's dropdown above the canvas to inspect every opening card and chapter layout.

## 5. Render Video
Before rendering, leave **Print Edition Promotion** enabled if the book is also sold in print or Kindle format. At 0:30 of the audiobook, the video will briefly show the selected cover and direct viewers to the Amazon link in the description. Turn it off for audiobook-only titles.

Once your fields are filled and chapters are parsed, click **Render Video**. The optimized renderer stores one high-resolution still per chapter, creates additional artwork only for transitions, intros, or the short promotional card, and then builds a broadly compatible constant-30fps video. Compatible compressed audio is copied directly, while other audio is cached after its first conversion. You can track progress in the log box at the bottom.

If a particular media file has trouble with the optimized renderer, enable **Compatibility Mode** in the export section to use the former segmented process. This fallback is substantially slower.
