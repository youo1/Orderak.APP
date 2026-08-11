#!/usr/bin/env bash
#
# Writes the placeholder google-services.json that Android CI builds need.
#
# The real file is a Firebase secret and is gitignored (apps/seller-android/
# .gitignore), so every job that runs a Gradle Android build has to synthesize
# one before Gradle's processGoogleServices task runs.
#
# This used to be an inline heredoc in four separate workflow steps, and four
# hand-maintained copies drifted exactly the way four hand-maintained copies do:
# two listed both flavours, apk-size listed only the base package, and
# screenshot-test wrote no file at all. Both of those jobs died in
# :app:processStagingDebugGoogleServices with
#
#   No matching client found for package name 'app.orderak.seller.staging'
#
# One definition instead. Adding a flavour means editing one file, and no job
# can quietly fall behind the others.
#
# Every value here is a placeholder. Firebase is never contacted in CI - the
# Google Services plugin only parses this file to generate resource values, so
# it has to be well-formed and cover every applicationId being built, but it
# does not have to be real.
#
# Usage: bash .github/scripts/write-ci-google-services.sh [destination]
set -euo pipefail

DEST="${1:-apps/seller-android/app/google-services.json}"
mkdir -p "$(dirname "$DEST")"

# One client per applicationId produced by app/build.gradle.kts:
#   production -> app.orderak.seller          (applicationId, no suffix)
#   staging    -> app.orderak.seller.staging  (applicationIdSuffix = ".staging")
# Neither debug nor release adds a further applicationIdSuffix, so these two
# cover all four variants.
cat > "$DEST" <<'JSON'
{
  "project_info": {
    "project_number": "100000000000",
    "project_id": "orderak-ci",
    "storage_bucket": "orderak-ci.invalid"
  },
  "client": [
    {
      "client_info": {
        "mobilesdk_app_id": "1:100000000000:android:0000000000000000",
        "android_client_info": {
          "package_name": "app.orderak.seller"
        }
      },
      "api_key": [
        {
          "current_key": "ci-placeholder-not-a-real-api-key"
        }
      ]
    },
    {
      "client_info": {
        "mobilesdk_app_id": "1:100000000000:android:1111111111111111",
        "android_client_info": {
          "package_name": "app.orderak.seller.staging"
        }
      },
      "api_key": [
        {
          "current_key": "ci-placeholder-not-a-real-api-key"
        }
      ]
    }
  ],
  "configuration_version": "1"
}
JSON

echo "Wrote CI Firebase placeholder to $DEST"
