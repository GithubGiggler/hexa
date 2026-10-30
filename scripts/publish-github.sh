#!/bin/bash
# Publishes Hexa to GitHub as a public repository under your account, once: fills in the OWNER
# placeholders (README, docs, package.json, the AUR PKGBUILD) with your GitHub user, commits that,
# creates the repository and pushes main. Run it yourself after `gh auth login`.
#
#   scripts/publish-github.sh [repo-name]     (default: hexa)

set -euo pipefail
cd "$(dirname "$0")/.."
name=${1:-hexa}

command -v gh >/dev/null || { echo "Install the GitHub CLI first (Fedora: sudo dnf install gh)."; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Log in first: gh auth login"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Commit or stash your changes first."; exit 1; }
owner=$(gh api user -q .login)
echo "Publishing as https://github.com/$owner/$name"

files=$(grep -rl --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.claude --exclude=publish-github.sh 'OWNER' . || true)
if [ -n "$files" ]; then
  # the repo's URLs first, then the remaining OWNER (maintainer lines)
  echo "$files" | xargs sed -i -e "s#github.com/OWNER/hexa#github.com/$owner/$name#g" -e "s#githubusercontent.com/OWNER/hexa#githubusercontent.com/$owner/$name#g" -e "s#OWNER#$owner#g"
  git add -A
  git commit -q -m "Publish under github.com/$owner/$name"
fi
# the repository field (left out until the owner was known)
node -e "
const fs = require('fs'); const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!p.repository) { p.repository = { type: 'git', url: 'https://github.com/$owner/$name.git' }; fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n'); }"
if [ -n "$(git status --porcelain)" ]; then git add package.json && git commit -q -m "package.json: repository"; fi

gh repo create "$name" --public --source . --remote origin \
  --description "Hexa: a Linux-native desktop companion who watches Claude Code work for you" --push
gh repo edit "$owner/$name" --add-topic claude-code --add-topic linux --add-topic desktop-pet --add-topic electron --add-topic kde
echo "Done: https://github.com/$owner/$name"
echo "To release: bump the version, then  git tag v<version> && git push origin v<version>  (CI builds the packages)."
