#!/bin/sh
set -eu

app_name="podlrc"
version=$(sed -n 's/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' podlrc.nimble | head -n 1)
arch=$(uname -m)

if [ -z "$version" ]; then
  echo "Could not read version from podlrc.nimble" >&2
  exit 1
fi

dist_dir="dist"
stage_dir="$dist_dir/$app_name-macos-$arch"
zip_name="$app_name-$version-macos-$arch.zip"
zip_path="$dist_dir/$zip_name"

rm -rf "$stage_dir" "$zip_path" "$zip_path.sha256"
mkdir -p "$stage_dir"

nim c -d:release \
  --nimcache:/tmp/podlrc_release_nimcache \
  -o:"$stage_dir/$app_name" \
  src/main.nim

cp README.md "$stage_dir/README.md"
chmod +x "$stage_dir/$app_name"

(
  cd "$dist_dir"
  zip -qr "$zip_name" "$(basename "$stage_dir")"
)

shasum -a 256 "$zip_path" > "$zip_path.sha256"

echo "Built release archive:"
echo "  $zip_path"
echo "  $zip_path.sha256"
