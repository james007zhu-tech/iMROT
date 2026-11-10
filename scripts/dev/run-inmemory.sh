#!/usr/bin/env bash
# Run the service layer + smoke test with plain Node and the in-memory Prisma stand-in.
# Rewrites imports so Node's --experimental-strip-types can resolve them (no bundler, no node_modules).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-/tmp/dcit-inmemory}"
rm -rf "$OUT"; mkdir -p "$OUT/src" "$OUT/scripts" "$OUT/prisma"
cp -r "$ROOT/src/lib" "$ROOT/src/server" "$OUT/src/"
cp "$ROOT/scripts/smoke.ts" "$OUT/scripts/"
cp "$ROOT/prisma/schema.prisma" "$OUT/prisma/"
cp "$ROOT/scripts/dev/fake-prisma.ts" "$OUT/src/lib/fake-prisma.ts"
cp "$ROOT/scripts/dev/zod-shim.ts" "$OUT/src/lib/zod-shim.ts"
cat > "$OUT/src/lib/db.ts" <<'EOF'
import { FakePrisma } from "./fake-prisma.ts";
export const prisma = new FakePrisma(new URL("../../prisma/schema.prisma", import.meta.url).pathname);
EOF
# rewrite imports
find "$OUT/src" "$OUT/scripts" -name '*.ts' | while read -r f; do
  rel="$(python3 -c "import os,sys;print(os.path.relpath('$OUT/src', os.path.dirname('$f')))")"
  sed -i -E \
    -e "s#from \"@/(lib|server|i18n)/([^\"]+)\"#from \"$rel/\1/\2.ts\"#g" \
    -e "s#from \"\.\./src/(lib|server)/([^\"]+)\"#from \"$rel/\1/\2.ts\"#g" \
    -e "s#from \"\./([a-zA-Z0-9_-]+)\"#from \"./\1.ts\"#g" \
    -e "s#from \"\.\./fx/([a-zA-Z0-9_-]+)\"#from \"../fx/\1.ts\"#g" \
    -e "s#import \{ PrismaClient \} from \"@prisma/client\"#import { PrismaClient } from \"$rel/lib/fake-prisma.ts\"#g" \
    -e "s#^import \{ Prisma \} from \"@prisma/client\"#import { Prisma } from \"$rel/lib/fake-prisma.ts\"#" \
    -e "s#from \"zod\"#from \"$rel/lib/zod-shim.ts\"#g" \
    -e "s#import \{ z \} from \"$rel/lib/zod-shim.ts\"#import { z } from \"$rel/lib/zod-shim.ts\"#" \
    "$f"
  # strip type-only imports from @prisma/client (Node erases `import type`, but inline `type` qualifiers need the module)
  sed -i -E 's#^import type \{[^}]*\} from "@prisma/client";##' "$f"
done
# `import("../src/server/alm")` dynamic import in smoke
sed -i -E "s#import\(\"\.\./src/server/alm\"\)#import(\"../src/server/alm.ts\")#" "$OUT/scripts/smoke.ts"
cd "$ROOT" && node --experimental-strip-types --no-warnings "$OUT/scripts/smoke.ts"
