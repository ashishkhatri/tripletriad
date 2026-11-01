#!/usr/bin/env bash
# Checks that a release is ready, then pushes main. GitHub Actions (.github/workflows/release.yml)
# tags the commit and publishes the release when it sees a new version in package.json.
#
#   1. Bump "version" in package.json
#   2. Add a "## vX.Y.Z" section to CHANGELOG.md
#   3. Commit, then run: tools/release.sh
set -Eeuo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
git diff --quiet && git diff --cached --quiet || { echo "Commit your changes first." >&2; exit 1; }
grep -q "^## $TAG" CHANGELOG.md || { echo "CHANGELOG.md has no '## $TAG' section." >&2; exit 1; }
git fetch -q --tags origin
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && { echo "$TAG is already released; bump the version." >&2; exit 1; }
git push -q origin main
echo "Pushed $TAG to main; the Release workflow will tag and publish it."
