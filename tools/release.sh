#!/usr/bin/env bash
# Tags the version in package.json, pushes main + the tag, and creates a GitHub release
# whose notes are that version's section of CHANGELOG.md.
#
#   tools/release.sh          # release the version currently in package.json
#
# Bump "version" in package.json and add a "## vX.Y.Z" section to CHANGELOG.md first.
set -Eeuo pipefail
cd "$(dirname "$0")/.."

REPO="${TRIAD_REPO:-ashishkhatri/tripletriad}"
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

git diff --quiet && git diff --cached --quiet || { echo "Commit your changes first." >&2; exit 1; }
grep -q "^## $TAG" CHANGELOG.md || { echo "CHANGELOG.md has no '## $TAG' section." >&2; exit 1; }
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && { echo "Tag $TAG already exists." >&2; exit 1; }

NOTES=$(awk -v t="## $TAG" '$0 ~ "^"t {on=1; next} /^## v/ && on {exit} on' CHANGELOG.md)

git tag -a "$TAG" -m "Triad $TAG"
git push -q origin main
git push -q origin "$TAG"

node -e '
  const [tag, notes] = process.argv.slice(1);
  process.stdout.write(JSON.stringify({ tag_name: tag, name: "Triad " + tag, body: notes.trim(), target_commitish: "main" }));
' "$TAG" "$NOTES" | gh api "repos/$REPO/releases" --method POST --input - --jq '.html_url'
