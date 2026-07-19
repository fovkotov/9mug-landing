# 9MUG landing

Лендинг сверстан по Figma с полноэкранными блоками, Lenis, скролл-синхронным видео, Radio-плеером и Brown Noise.

## Локальный запуск

```bash
npm install
npm run dev
```

## Прод сборка

```bash
npm run build
```

## GitHub Pages

Workflow `Deploy to GitHub Pages` публикует сайт при каждом пуше в `main`.

1. В репозитории открой `Settings -> Pages`.
2. Выбери `Build and deployment: GitHub Actions`.
3. После первого пуша получишь URL вида:
   `https://<github-username>.github.io/<repo-name>/`.

Если нужен кастомный домен, добавь файл `public/CNAME` с нужным доменом.
