# KoK QA Test Cases

## Automated

- Home smoke: app renders on mobile and desktop, primary buttons are visible, no horizontal overflow.
- Guest planner: guest entry opens planner, page tabs render, no horizontal overflow.
- Options: only simple presets are shown, `Lv.*`, `이동시간 공정도`, and `AI 연결` are not shown.
- Accent consistency: old green accent RGB values are not used in rendered home/options UI.
- Participant form: long typed name and long address query do not push layout outside the viewport.
- Long place cards: parking, nearby place, and map detail card fixtures with extreme place/address text do not overflow.

Run:

```bash
npm run qa:ui
```

If browsers are missing:

```bash
npm run qa:ui:install
```

## Manual Release Checks

- iPhone WebView/Safari: bottom fixed CTA is not hidden by browser chrome.
- Result screen with real Naver results: parking cards, nearby places, and map detail cards stay inside the card.
- Result screen with station names: long station names do not clip the station sign.
- Fairness mode: selecting `가장 공평`, `적당히`, and `후보 넓게` visibly changes the summary.
- Shared room: ready CTA, redraw, and share controls remain tappable on a small iPhone viewport.
- App Store screenshots: home, map, participants, options, draw, and result screens are regenerated after visible UI changes.
