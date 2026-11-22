#!/bin/sh
# Copia o dist/ do Rochedo (design system) para ./rochedo/. Uso: scripts/sync-rochedo.sh [tag]  (padrão: v0.1.0)
set -e
TAG="${1:-v0.1.0}"
TMP="$(mktemp -d)"
git clone -q --depth 1 --branch "$TAG" https://github.com/soumfilipe/rochedo.git "$TMP"
rm -rf rochedo && mkdir rochedo
cp -R "$TMP/dist/." rochedo/
echo "$TAG" > rochedo/VERSAO
rm -rf "$TMP"
echo "Rochedo $TAG copiado para ./rochedo/. Se mudou arquivo, suba o CACHE em sw.js e a lista SHELL."
