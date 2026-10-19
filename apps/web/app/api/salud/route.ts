import { atenderLaSalud } from "../../../servidor/rutas-de-sistema";

// ¿Responde la base con el rol limitado de la aplicación? Pública y sin datos: `{"ok":true}` (200) o
// `{"ok":false}` (503), sin motivo ni detalle (ADR-016). Solo GET (y HEAD, que Next deriva de él).

// `pg` necesita Node, y esto no se cachea nunca ni se genera al compilar.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = atenderLaSalud;
