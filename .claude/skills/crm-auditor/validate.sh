#!/usr/bin/env bash
# Validación estructural del skill crm-auditor: frontmatter, referencias y placeholders sin llenar.
set -euo pipefail
cd "$(dirname "$0")"
fail=0

# 1. Frontmatter del SKILL.md
head -5 SKILL.md | grep -q "name: crm-auditor" || { echo "FALTA 'name: crm-auditor' en SKILL.md"; fail=1; }

# 2. Todos los archivos referenciados existen
for f in safety-contract.md provisioning.md ticket-template.md references/recon-notes.md \
         playbooks/asesor.md playbooks/sistemas-qa.md playbooks/gerente.md \
         playbooks/director.md playbooks/marketing-admin.md; do
  test -f "$f" || { echo "FALTA $f"; fail=1; }
done

# 3. Sin placeholders sin llenar (marcadores literales de las plantillas del plan)
#    Se excluye este propio script, que contiene los literales en el patrón de búsqueda.
if grep -rnF --exclude=validate.sh -e '<ruta>' -e '<...>' -e 'RELLENAR' . >/dev/null 2>&1; then
  echo "HAY placeholders sin llenar (<ruta> / <...> / RELLENAR):"
  grep -rnF --exclude=validate.sh -e '<ruta>' -e '<...>' -e 'RELLENAR' .
  fail=1
fi

if [ $fail -eq 0 ]; then echo "VALIDATE OK"; else echo "VALIDATE FAIL"; exit 1; fi
