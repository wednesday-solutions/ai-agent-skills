#!/bin/bash
set -eo pipefail

DRY_RUN=false
BASE_BRANCH="develop"
SONAR_URL="http://localhost:9000"
SONAR_PROJECT_KEY="absli-spectre"
SONAR_TOKEN=""
SKIP_SCAN=false

# Parse flags
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)    DRY_RUN=true; shift ;;
    --post)       DRY_RUN=false; shift ;;
    --skip-scan)  SKIP_SCAN=true; shift ;;
    --token)      SONAR_TOKEN="$2"; shift 2 ;;
    --token=*)    SONAR_TOKEN="${1#--token=}"; shift ;;
    --url)        SONAR_URL="$2"; shift 2 ;;
    --url=*)      SONAR_URL="${1#--url=}"; shift ;;
    *)            BASE_BRANCH="$1"; shift ;;
  esac
done

PROJECT_ROOT="$(git rev-parse --show-toplevel)"

# --- Validate token ---
if [ -z "$SONAR_TOKEN" ]; then
  # Check for env variable
  if [ -n "$SONAR_TOKEN_ENV" ]; then
    SONAR_TOKEN="$SONAR_TOKEN_ENV"
  else
    echo "Error: SonarQube token is required."
    echo "Usage: bash pr-sonar.sh --token <your-sonar-token> [--dry-run]"
    echo "Or set SONAR_TOKEN_ENV environment variable."
    exit 1
  fi
fi

# --- Check SonarQube server is reachable ---
echo "Checking SonarQube server at $SONAR_URL..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$SONAR_URL/api/system/status" 2>/dev/null || echo "000")
if [ "$STATUS" != "200" ]; then
  echo "Error: SonarQube server at $SONAR_URL is not reachable (HTTP $STATUS)."
  exit 1
fi
echo "SonarQube server is up."

# --- Get changed JS files ---
CHANGED_FILES=$(git diff --name-only "$BASE_BRANCH"...HEAD -- '*.js' '*.jsx')

if [ -z "$CHANGED_FILES" ]; then
  echo "No JS/JSX files changed compared to $BASE_BRANCH"
  exit 0
fi

FILE_COUNT=$(echo "$CHANGED_FILES" | wc -l | tr -d ' ')
echo "Found $FILE_COUNT changed file(s) vs $BASE_BRANCH"

# --- Run sonar-scanner (unless --skip-scan) ---
if [ "$SKIP_SCAN" = false ]; then
  echo ""
  echo "Running sonar-scanner from project root..."
  cd "$PROJECT_ROOT"
  sonar-scanner \
    -Dsonar.projectKey="$SONAR_PROJECT_KEY" \
    -Dsonar.host.url="$SONAR_URL" \
    -Dsonar.token="$SONAR_TOKEN" \
    -Dsonar.sources="." \
    -Dsonar.exclusions="**/node_modules/**,**/coverage/**,**/dist/**,**/build/**,**/*.test.js,**/*.test.cases.js,**/tests/**,**/mock-data/**,**/__mocks__/**"

  # --- Wait for analysis to complete ---
  REPORT_TASK_FILE="$PROJECT_ROOT/.scannerwork/report-task.txt"
  if [ ! -f "$REPORT_TASK_FILE" ]; then
    echo "Error: report-task.txt not found. Scanner may have failed."
    exit 1
  fi

  CE_TASK_URL=$(grep "ceTaskUrl=" "$REPORT_TASK_FILE" | cut -d'=' -f2-)
  echo ""
  echo "Waiting for SonarQube analysis to complete..."

  MAX_WAIT=120
  ELAPSED=0
  while [ $ELAPSED -lt $MAX_WAIT ]; do
    TASK_STATUS=$(curl -s -u "$SONAR_TOKEN:" "$CE_TASK_URL" | python3 -c "import sys,json; print(json.load(sys.stdin)['task']['status'])" 2>/dev/null || echo "UNKNOWN")

    case "$TASK_STATUS" in
      SUCCESS)
        echo "Analysis completed."
        break
        ;;
      FAILED|CANCELED)
        echo "Error: Analysis task $TASK_STATUS."
        exit 1
        ;;
      *)
        sleep 3
        ELAPSED=$((ELAPSED + 3))
        ;;
    esac
  done

  if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "Error: Timed out waiting for analysis to complete."
    exit 1
  fi
else
  echo "Skipping scan (--skip-scan). Using existing SonarQube data."
fi

# --- Query issues for changed files ---
echo ""
echo "Fetching issues for changed files..."

# Build comma-separated file list for the API
FILE_LIST=""
while IFS= read -r file; do
  if [ -n "$FILE_LIST" ]; then
    FILE_LIST="$FILE_LIST,$file"
  else
    FILE_LIST="$file"
  fi
done <<EOF
$CHANGED_FILES
EOF

# URL-encode commas in the file list
ENCODED_FILES=$(echo "$FILE_LIST" | sed 's/,/%2C/g')

# Fetch all open issues for changed files (paginate if needed)
PAGE=1
PAGE_SIZE=500
ALL_ISSUES=""
TOTAL_ISSUES=0

while true; do
  RESPONSE=$(curl -s -u "$SONAR_TOKEN:" \
    "$SONAR_URL/api/issues/search?componentKeys=$SONAR_PROJECT_KEY&files=$ENCODED_FILES&statuses=OPEN,CONFIRMED,REOPENED&impactSeverities=BLOCKER,HIGH,MEDIUM,LOW&ps=$PAGE_SIZE&p=$PAGE")

  ISSUES=$(echo "$RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for issue in data.get('issues', []):
    impacts = issue.get('impacts', [])
    severity = impacts[0]['severity'] if impacts else 'UNKNOWN'
    quality = impacts[0]['softwareQuality'] if impacts else ''
    msg = issue.get('message', '')
    component = issue.get('component', '').replace('$SONAR_PROJECT_KEY:', '')
    line = issue.get('line', '-')
    rule = issue.get('rule', '')
    effort = issue.get('effort', '-')
    print(f'{severity}|{component}:{line}|{rule}|{msg}|{quality}|{effort}')
" 2>/dev/null) || true

  TOTAL=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")

  if [ -n "$ISSUES" ]; then
    if [ -n "$ALL_ISSUES" ]; then
      ALL_ISSUES="$ALL_ISSUES
$ISSUES"
    else
      ALL_ISSUES="$ISSUES"
    fi
  fi

  TOTAL_ISSUES=$TOTAL
  FETCHED=$((PAGE * PAGE_SIZE))
  if [ "$FETCHED" -ge "$TOTAL_ISSUES" ]; then
    break
  fi
  PAGE=$((PAGE + 1))
done

echo "Found $TOTAL_ISSUES issue(s) in changed files."

# --- Build scanned files list ---
FILES_LIST=""
while IFS= read -r file; do
  [ -z "$file" ] && continue
  FILES_LIST="$FILES_LIST
- \`$file\`"
done <<EOF
$CHANGED_FILES
EOF

# --- Build report ---
if [ "$TOTAL_ISSUES" -eq 0 ]; then
  REPORT="## SonarQube Report — Changed Files

No issues found in the changed files.

<details>
<summary>Scanned Files ($FILE_COUNT)</summary>
$FILES_LIST
</details>

> Auto-generated for files changed in this PR vs \`$BASE_BRANCH\`."
else
  # Count by MQR severity
  BLOCKER=$(echo "$ALL_ISSUES" | grep -c "^BLOCKER|" || true)
  HIGH=$(echo "$ALL_ISSUES" | grep -c "^HIGH|" || true)
  MEDIUM=$(echo "$ALL_ISSUES" | grep -c "^MEDIUM|" || true)
  LOW=$(echo "$ALL_ISSUES" | grep -c "^LOW|" || true)

  # Build summary
  SUMMARY=""
  [ "$BLOCKER" -gt 0 ] && SUMMARY="$SUMMARY| Blocker | $BLOCKER |
"
  [ "$HIGH" -gt 0 ] && SUMMARY="$SUMMARY| High | $HIGH |
"
  [ "$MEDIUM" -gt 0 ] && SUMMARY="$SUMMARY| Medium | $MEDIUM |
"
  [ "$LOW" -gt 0 ] && SUMMARY="$SUMMARY| Low | $LOW |
"

  # Build issues table
  ISSUES_TABLE="| Severity | Quality | File | Rule | Message |
|----------|---------|------|------|---------|
"
  while IFS='|' read -r sev loc rule msg quality effort; do
    [ -z "$sev" ] && continue
    ISSUES_TABLE="$ISSUES_TABLE| $sev | $quality | \`$loc\` | $rule | $msg |
"
  done <<EOF
$ALL_ISSUES
EOF

  REPORT="## SonarQube Report — Changed Files

### Summary
| Severity | Count |
|----------|-------|
${SUMMARY}
**Total: $TOTAL_ISSUES issue(s)**

### Issues
$ISSUES_TABLE
<details>
<summary>Scanned Files ($FILE_COUNT)</summary>
$FILES_LIST
</details>

> Auto-generated for files changed in this PR vs \`$BASE_BRANCH\`."
fi

echo ""
echo "=========================================="
echo "$REPORT"
echo "=========================================="

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "Dry run complete. Use --post to publish to PR."
  exit 0
fi

# --- Post to PR ---
PR_NUMBER=$(gh pr view --json number -q '.number')
EXISTING_COMMENT_ID=$(gh api "repos/{owner}/{repo}/issues/${PR_NUMBER}/comments" \
  --jq '.[] | select(.body | startswith("## SonarQube Report")) | .id' \
  | tail -1)

if [ -n "$EXISTING_COMMENT_ID" ]; then
  gh api "repos/{owner}/{repo}/issues/comments/${EXISTING_COMMENT_ID}" \
    -X PATCH -f body="$REPORT" --silent
  echo ""
  echo "Updated existing SonarQube comment on PR."
else
  gh pr comment --body "$REPORT"
  echo ""
  echo "Posted new SonarQube comment to PR."
fi

PR_URL=$(gh pr view --json url -q '.url')
echo "View: $PR_URL"