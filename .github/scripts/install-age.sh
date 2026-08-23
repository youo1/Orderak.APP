#!/usr/bin/env bash
#
# Installs the pinned age binary used for D1 backup encryption and restore
# drills. Shared by d1-backup.yml (production and staging jobs) and
# restore-drill.yml so the version and checksum have a single source of truth.
#
# Pinned and SHA-256 verified rather than installed from a package manager:
# the tool that guards the backup path is itself pinned the way the rest of
# this repository pins everything else.
set -euo pipefail

curl -fsSL -o /tmp/age.tar.gz \
  "https://github.com/FiloSottile/age/releases/download/v1.3.1/age-v1.3.1-linux-amd64.tar.gz"
echo "bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377  /tmp/age.tar.gz" | sha256sum -c -
tar -xzf /tmp/age.tar.gz -C /tmp
sudo mv /tmp/age/age /tmp/age/age-keygen /usr/local/bin/
age --version