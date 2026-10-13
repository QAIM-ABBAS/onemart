#!/usr/bin/env bash
cd "$(dirname "$0")/.." || exit 1
INC=(--include='*.tsx' --include='*.ts' --include='*.jsx' --include='*.css')
echo "== 1. Physical Tailwind classes still present =="
grep -rnE "${INC[@]}" '(^|[^A-Za-z0-9_])-?(ml|mr|pl|pr|left|right)-|text-(left|right)\b|rounded-(l|r|tl|tr|bl|br)\b|border-(l|r)\b|float-(left|right)' src \
  | grep -v 'left-1/2' | grep -v 'right-1/2' || echo "none"
echo; echo "== 2. space-x / divide-x without rtl reverse =="
grep -rnE "${INC[@]}" '(space|divide)-x' src | grep -v 'rtl:space-x-reverse' | grep -v 'rtl:divide-x-reverse' || echo "none"
echo; echo "== 3. Inline styles / physical CSS / scroll / translate =="
grep -rnE "${INC[@]}" 'marginLeft|marginRight|paddingLeft|paddingRight|textAlign: ?.(left|right)|scrollLeft|scrollBy|translate-x-|translateX|borderLeft|borderRight' src || echo "none"
echo; echo "== 4. Directional icons / arrows =="
grep -rnE "${INC[@]}" 'Chevron(Left|Right)|Arrow(Left|Right)|ArrowBack|ArrowForward|ArrowUpRight|CaretLeft|CaretRight|←|→|‹|›' src || echo "none"
echo; echo "== 5. Library props with a physical side =="
grep -rnE "${INC[@]}" "(side|align|placement|position|direction|anchor)=['\"{ ]*['\"]?(left|right|top-left|top-right|bottom-left|bottom-right)" src || echo "none"
echo; echo "== 6. Likely hardcoded UI text (should use t()) =="
grep -rnE --include='*.tsx' '>[[:space:]]*[A-Z][A-Za-z ,.!?&-]{3,}[[:space:]]*<|placeholder="[A-Za-z]|aria-label="[A-Za-z]|title="[A-Za-z]' src | grep -v "t('" | head -150
