#!/usr/bin/env bash
set -euo pipefail
SOURCE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="excude/expense_tracker"
cd "$HOME/storage/downloads/expense-tracker"
gh auth setup-git
git checkout main
git pull --ff-only origin main
cp -a "$SOURCE/." .
git rm --ignore-unmatch public/vendor/sql-asm.js
git add public bridge tests scripts .github package.json README.md VERSION .gitignore .firebaserc firebase.json firestore.rules firestore.indexes.json
if ! git diff --cached --quiet; then git commit -m "Release v$(cat VERSION)"; fi
git push origin main
BEFORE="$(gh run list --repo "$REPO" --workflow pages.yml --event workflow_dispatch --branch main --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
gh workflow run pages.yml --repo "$REPO" --ref main
for attempt in $(seq 1 30); do
 RUN="$(gh run list --repo "$REPO" --workflow pages.yml --event workflow_dispatch --branch main --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
 if [ -n "$RUN" ] && [ "$RUN" != "$BEFORE" ]; then
  gh run watch "$RUN" --repo "$REPO" --exit-status
  echo "배포 완료: https://excude.github.io/expense_tracker/"
  exit 0
 fi
 sleep 2
done
echo '배포 요청은 완료했지만 실행 확인이 지연됩니다. GitHub Actions를 확인하세요.'
exit 1
