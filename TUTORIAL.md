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
- **Transition Style** defaults to **Cut**, switching instantly at each chapter marker. Optional effects like Fade to Black straddle the marker: the fade reaches black at the marker, then reveals the next chapter. Their duration shortens automatically around short chapters, so they never add time. Existing projects retain their saved selection.
- Enable **Opening Title Sequence** to rotate the book title/subtitle, optional series and book number, author, original publication, and site through the right-side title area at the start. The small heading above the title is editable. The title appears first, then the subtitle fades in two seconds later without moving the title. Both stay fully visible for at least four seconds. A full title/subtitle opening lasts eight seconds; a title alone lasts six. Other cards last about three seconds. Short opening chapters can shorten the holds, but skip the sequence if its minimum reading times cannot fit. Site addresses use smaller uppercase lettering. The cover remains fixed and chapter/audio timing does not change. The app renders each state once and lets FFmpeg animate the crossfades efficiently.
- Use the **Preview** section's dropdown above the canvas to inspect every opening card and chapter layout.

## 5. Render Video
Before rendering, leave **Print Edition Promotion** enabled if the book is also sold in print or Kindle format. At 0:30 of the audiobook, the video will briefly show the book and direct viewers to the Amazon link in the description. It uses the main cover by default; optionally choose a separate PNG—such as a transparent 3D book mockup—under **Promotion Artwork**. Clear that selection at any time to return to the main cover. Turn the promotion off for audiobook-only titles.

For longer books, the same promotion repeats for eight seconds around the 2-hour, 4-hour, 6-hour marks, and so on, randomly within ten minutes of each mark. The number of repeats follows the audiobook's length; books under two hours only get the first appearance. Repeats finish before the final minute. Locations stay consistent when rendering the same audio file again, and the render log lists their times. Switching off **Print Edition Promotion** disables every appearance.

Once your fields are filled and chapters are parsed, click **Render Video**. The optimized renderer stores one high-resolution still per chapter, creates additional artwork only for transitions, intros, or the short promotional card, and then builds a broadly compatible constant-30fps video. Compatible compressed audio is copied directly, while other audio is cached after its first conversion. You can track progress in the log box at the bottom.

After a successful export, click **Open Video** beside the render button to watch the finished MP4 immediately in your default video player.

The export area shows elapsed time and an approximate remaining time once a successful render with comparable settings has been saved. Estimates use the previous video's length and measured render progress, and stay separate for different codecs, encoder modes, and rendering settings. Your first render supplies the timing history; older exports cannot be timed retrospectively. The last successful render's exact duration remains visible after restarting the app.

A successful render plays a short chime and shows a desktop notification. **Play sound when rendering finishes** is enabled by default and remembered across projects. Click **Test sound** to check your speakers. Clicking the notification returns to the app. Computer volume and operating-system notification settings still apply.

If a particular media file has trouble with the optimized renderer, enable **Compatibility Mode** in the export section to use the former segmented process. This fallback is substantially slower.
