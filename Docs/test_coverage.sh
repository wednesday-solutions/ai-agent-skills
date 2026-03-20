#!/bin/bash
set -eo pipefail

DRY_RUN=false
BASE_BRANCH="develop"

# Parse flags
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --post)    DRY_RUN=false; shift ;;
    *)         BASE_BRANCH="$1"; shift ;;
  esac
done

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
FULL_REPORT=""
HAS_COVERAGE=false

# --- Get changed JS files (committed on this branch vs base) ---
CHANGED_FILES=$(git diff --name-only "$BASE_BRANCH"...HEAD -- '*.js')

if [ -z "$CHANGED_FILES" ]; then
  echo "No JS files changed compared to $BASE_BRANCH"
  exit 0
fi

FILE_COUNT=$(echo "$CHANGED_FILES" | wc -l | tr -d ' ')
echo "Found $FILE_COUNT changed JS file(s) vs $BASE_BRANCH"

# --- Group files by package ---
LIB_FILES=""
MODULES_FILES=""
BACKEND_FILES=""

while IFS= read -r file; do
  case "$file" in
    packages/lib/*)     LIB_FILES="$LIB_FILES ${file#packages/lib/}" ;;
    packages/modules/*) MODULES_FILES="$MODULES_FILES ${file#packages/modules/}" ;;
    apps/backend/*)     BACKEND_FILES="$BACKEND_FILES ${file#apps/backend/}" ;;
  esac
done <<EOF
$CHANGED_FILES
EOF

# Trim leading spaces
LIB_FILES=$(echo "$LIB_FILES" | sed 's/^ //')
MODULES_FILES=$(echo "$MODULES_FILES" | sed 's/^ //')
BACKEND_FILES=$(echo "$BACKEND_FILES" | sed 's/^ //')

# --- Helper: run coverage for a package ---
run_coverage() {
  pkg_dir="$1"
  pkg_label="$2"
  shift 2
  all_files="$*"

  source_files=""
  abs_all_files=""

  for f in $all_files; do
    abs_all_files="$abs_all_files $PROJECT_ROOT/$pkg_dir/$f"
    # Exclude test files from coverage collection
    case "$f" in
      *.test.*) ;;
      *) source_files="$source_files $f" ;;
    esac
  done

  source_files=$(echo "$source_files" | sed 's/^ //')
  abs_all_files=$(echo "$abs_all_files" | sed 's/^ //')

  if [ -z "$source_files" ]; then
    echo "  No source files (only tests) in $pkg_label — skipping coverage collection."
    return
  fi

  echo ""
  echo "=== $pkg_label ==="
  echo "  Source files for coverage: $source_files"

  # Build JSON array of source files for collectCoverageFrom
  json_array="["
  first=true
  for f in $source_files; do
    if [ "$first" = true ]; then
      first=false
    else
      json_array="$json_array,"
    fi
    json_array="$json_array\"$f\""
  done
  json_array="$json_array]"

  # Create a temporary jest config that extends the package config
  # but overrides collectCoverageFrom and removes restrictive ignore patterns
  tmp_config="$PROJECT_ROOT/$pkg_dir/.pr-coverage.config.js"
  cat > "$tmp_config" <<JSEOF
const baseConfig = require('./jest.config');
module.exports = {
  ...baseConfig,
  collectCoverageFrom: ${json_array},
  coveragePathIgnorePatterns: ['/node_modules/'],
  coverageThreshold: {},
};
JSEOF

  # Run jest with temp config — findRelatedTests for speed, output JSON coverage
  coverage_dir="$PROJECT_ROOT/$pkg_dir/coverage"
  rm -rf "$coverage_dir"

  # For backend route files, --findRelatedTests won't work because test files
  # don't import the source file directly. Detect sibling tests/ directory tests
  # by convention and add them so Jest can find them.
  if [ "$pkg_dir" = "apps/backend" ]; then
    for f in $abs_all_files; do
      case "$f" in
        */lib/routes/*.js)
          dir=$(dirname "$f")
          base=$(basename "$f" .js)
          for test_dir in "$dir/tests" "$dir/test"; do
            convention_test="$test_dir/$base.test.js"
            if [ -f "$convention_test" ]; then
              case " $abs_all_files " in
                *" $convention_test "*) ;;
                *) abs_all_files="$abs_all_files $convention_test" ;;
              esac
            fi
          done
          ;;
      esac
    done
  fi

  # Quote each file path individually to prevent brace/glob expansion
  # (e.g. paths containing {journeyId} would be expanded by the shell)
  quoted_files=""
  for f in $abs_all_files; do
    quoted_files="$quoted_files \"$f\""
  done

  (cd "$PROJECT_ROOT/$pkg_dir" && eval npx jest \
    --config=".pr-coverage.config.js" \
    --coverage \
    --coverageReporters=json \
    --passWithNoTests \
    --findRelatedTests $quoted_files 2>&1) || true

  # Clean up temp config
  rm -f "$tmp_config"

  # Read coverage JSON and filter to only changed files, then generate table
  coverage_json="$coverage_dir/coverage-final.json"

  if [ ! -f "$coverage_json" ]; then
    echo "  Warning: No coverage JSON found at $coverage_json"
    FULL_REPORT="$FULL_REPORT
### \`$pkg_label\`
No coverage data generated.
"
    return
  fi

  # Build jq filter for the source files we want
  # Convert space-separated paths to jq array selector
  jq_filter=""
  pkg_dir_abs="$PROJECT_ROOT/$pkg_dir/"
  for f in $source_files; do
    abs_path="$PROJECT_ROOT/$pkg_dir/$f"
    if [ -z "$jq_filter" ]; then
      jq_filter=".[\"$abs_path\"]"
    else
      jq_filter="$jq_filter, .[\"$abs_path\"]"
    fi
  done

  # Extract coverage stats for each file and format as table
  # Use relative path by stripping the package directory prefix
  table=$(jq -r --arg prefix "$pkg_dir_abs" "[$jq_filter] | map(select(. != null)) | .[] |
    {
      file: (.path | ltrimstr(\$prefix)),
      stmts: (if .s | length == 0 then 100 else (([.s | to_entries[] | select(.value > 0)] | length) / ([.s | to_entries[]] | length) * 100) end),
      branch: (if .b | length == 0 then 100 else (([.b | to_entries[] | .value[] | select(. > 0)] | length) / ([.b | to_entries[] | .value | length] | add) * 100) end),
      funcs: (if .f | length == 0 then 100 else (([.f | to_entries[] | select(.value > 0)] | length) / ([.f | to_entries[]] | length) * 100) end),
      lines: (if .s | length == 0 then 100 else (([.s | to_entries[] | select(.value > 0)] | length) / ([.s | to_entries[]] | length) * 100) end)
    } |
    \"\(.file) | \(.stmts | floor) | \(.branch | floor) | \(.funcs | floor) | \(.lines | floor)\"
  " "$coverage_json" 2>/dev/null)

  if [ -z "$table" ]; then
    echo "  Warning: Could not extract coverage from JSON"
    FULL_REPORT="$FULL_REPORT
### \`$pkg_label\`
No coverage data generated.
"
    return
  fi

  # Format the table with headers
  formatted_table="File | % Stmts | % Branch | % Funcs | % Lines
-----|---------|----------|---------|--------"
  while IFS='|' read -r file stmts branch funcs lines; do
    # Trim whitespace
    file=$(echo "$file" | xargs)
    stmts=$(echo "$stmts" | xargs)
    branch=$(echo "$branch" | xargs)
    funcs=$(echo "$funcs" | xargs)
    lines=$(echo "$lines" | xargs)
    formatted_table="$formatted_table
$file | $stmts | $branch | $funcs | $lines"
  done <<< "$table"

  HAS_COVERAGE=true
  FULL_REPORT="$FULL_REPORT
### \`$pkg_label\`
$formatted_table
"
}

# --- Run coverage per package ---
if [ -n "$LIB_FILES" ]; then
  run_coverage "packages/lib" "packages/lib" $LIB_FILES
fi

if [ -n "$MODULES_FILES" ]; then
  run_coverage "packages/modules" "packages/modules" $MODULES_FILES
fi

if [ -n "$BACKEND_FILES" ]; then
  run_coverage "apps/backend" "apps/backend" $BACKEND_FILES
fi

if [ "$HAS_COVERAGE" = false ]; then
  echo ""
  echo "No coverage data was generated for any package."
  exit 0
fi

# --- Build comment body ---
COMMENT="## Coverage Report — Changed Files
${FULL_REPORT}
> Auto-generated for files changed in this PR vs \`$BASE_BRANCH\`."

echo ""
echo "=========================================="
echo "$COMMENT"
echo "=========================================="

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "Dry run complete. Use --post to publish to PR."
  exit 0
fi

# Find existing coverage comment by this script's marker text
if [ -z "$PR_NUMBER" ]; then
  PR_NUMBER=$(gh pr view --json number -q '.number')
fi
REPO=${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}

EXISTING_COMMENT_ID=$(gh api "repos/$REPO/issues/${PR_NUMBER}/comments" --paginate \
  --jq '.[] | select(.body | startswith("## Coverage Report — Changed Files")) | .id' \
  | tail -n 1)

if [ -n "$EXISTING_COMMENT_ID" ]; then
  gh api "repos/$REPO/issues/comments/${EXISTING_COMMENT_ID}" \
    -X PATCH -f body="$COMMENT" --silent
  echo ""
  echo "Updated existing coverage comment on PR."
else
  gh pr comment "$PR_NUMBER" --repo "$REPO" --body "$COMMENT"
  echo ""
  echo "Posted new coverage comment to PR."
fi

PR_URL=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json url -q '.url')
echo "View: $PR_URL"