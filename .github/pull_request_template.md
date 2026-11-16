## Summary of Changes
Briefly describe what this pull request changes and why.

## Related Issue
Closes #

## Verification Checklist
- [ ] All JavaScript files pass `node --check` (`background.js`, `content.js`, `record.js`, `editor.js`, `video-processor.js`, `zoom-analyzer.js`).
- [ ] Both `record.html` and `editor.html` maintain 100/100 accessibility and semantic HTML scores (every form input has an explicit `aria-label` or `<label>`).
- [ ] If `_locales/` or `manifest.json` strings were modified, all 56 locale files validate with `extName <= 45` chars and `extDescription <= 132` chars.
- [ ] 100% local processing preserved (zero external network requests or third-party tracking).
- [ ] Tested unpacked extension in Chrome (`record.html` capture + `editor.html` zoom/blur/MP4 export).
